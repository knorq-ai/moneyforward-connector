import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import type { OAuthTokens } from '../types/index.js';
import type { ServiceConfig } from '../config.js';
import { getLegacyTokensFile } from '../config.js';

const DEFAULT_PORT = 38080;
const OOB_REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

/**
 * コールバックサーバは必ずループバックにだけ bind する。host を省略すると
 * `0.0.0.0` / `::` に bind され、同一 LAN の別ホストから
 * `/callback?error=...` を投げて認証フローを落とせてしまう。
 *
 * bind するアドレスはリダイレクト URI から決める。`127.0.0.1` なら IPv4、
 * `[::1]` なら IPv6、`localhost` はどちらに解決されるか分からないので**両方**を
 * 必須とする。必須の listener が 1 つでも上がらなければ認証を開始しない
 * （上がったつもりでコールバックが届かない、という分かりにくい失敗を防ぐ）。
 */
const PRIMARY_LOOPBACK_HOST = '127.0.0.1';
const SECONDARY_LOOPBACK_HOST = '::1';

/** トークンファイル / 設定ディレクトリのパーミッション（所有者のみ） */
const TOKEN_FILE_MODE = 0o600;
const CONFIG_DIR_MODE = 0o700;

const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * コールバックサーバが返す HTML に差し込む値をエスケープする。
 * `error` クエリなど外部由来の文字列をそのまま埋めると反射型 XSS になる。
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** state の比較はタイミング差を作らない。長さが違う時点で不一致とする。 */
function statesMatch(received: string | null, expected: string): boolean {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** MF_CALLBACK_PORT を検証する。0（エフェメラル）や範囲外は黙って使わない。 */
export function resolveCallbackPort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`MF_CALLBACK_PORT が数値ではありません: ${raw}`);
  }
  const port = Number(raw.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`MF_CALLBACK_PORT が範囲外です（1-65535）: ${raw}`);
  }
  return port;
}

/**
 * MF_REDIRECT_URI を検証する。OOB か、このプロセスが listen するポートと
 * 一致するループバック URL のみ許可する。ポート不一致は「認証は通るが
 * コールバックが返ってこない」という分かりにくい失敗になるため、先に弾く。
 */
export function validateRedirectUri(raw: string, expectedPort: number): string {
  if (raw === OOB_REDIRECT_URI) return raw;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `MF_REDIRECT_URI が URL として不正です: ${raw}`
        + `（例: http://127.0.0.1:${expectedPort}/callback、または ${OOB_REDIRECT_URI}）`
    );
  }
  if (url.protocol !== 'http:') {
    throw new Error(`MF_REDIRECT_URI は http:// のループバック URL を指定してください: ${raw}`);
  }
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost' && url.hostname !== '[::1]') {
    throw new Error(
      `MF_REDIRECT_URI のホストは 127.0.0.1 / [::1] / localhost のみ許可します: ${url.hostname}`
    );
  }
  const uriPort = url.port === '' ? 80 : Number(url.port);
  if (uriPort !== expectedPort) {
    throw new Error(
      `MF_REDIRECT_URI のポート (${uriPort}) と MF_CALLBACK_PORT (${expectedPort}) が一致しません`
    );
  }
  return raw;
}

/**
 * 同時に複数サービスが auth_start を呼ぶと、同一ポートでコールバックサーバが
 * 衝突し、後勝ちで前のフローが破棄される。サービス名を持つモジュールレベルロック
 * で逐次化する。OOB モードはサーバを立てないため対象外。
 */
let currentlyAuthenticatingService: string | null = null;

export function getCurrentlyAuthenticatingService(): string | null {
  return currentlyAuthenticatingService;
}

/** 進行中のコールバックフロー。差し替え時に前のフローを確実に終わらせるために保持する。 */
interface PendingFlow {
  generation: number;
  state: string;
  timeoutId: NodeJS.Timeout;
  servers: http.Server[];
  /** コールバックは 1 回だけ受け付ける。2 回目以降は無視する。 */
  consumed: boolean;
  settle: (result: { tokens?: OAuthTokens; error?: Error }) => void;
}

export class OAuthManager {
  private config: ServiceConfig;
  private tokens: OAuthTokens | null = null;
  private port: number;
  private pending: PendingFlow | null = null;
  private generationCounter = 0;

  constructor(config: ServiceConfig) {
    this.config = config;
    this.port = resolveCallbackPort(process.env.MF_CALLBACK_PORT);
    this.hardenExistingStorage();
    this.migrateTokens();
    this.loadTokens();
  }

  /**
   * 既存のトークンファイル / ディレクトリのパーミッションを起動時に締める。
   * 旧実装は 0644 で書いていたため、アップグレードしただけの環境は
   * 書き換えが起きるまで緩いままになる。legacy パスも同様に締める。
   */
  private hardenExistingStorage(): void {
    const targets = [this.config.storage.tokensFile];
    if (this.config.name === 'invoice') targets.push(getLegacyTokensFile());

    for (const file of targets) {
      for (const [target, mode] of [
        [path.dirname(file), CONFIG_DIR_MODE],
        [file, TOKEN_FILE_MODE],
      ] as const) {
        if (!fs.existsSync(target)) continue;
        this.hardenPath(target, mode);
      }
    }
  }

  /**
   * パスを開いて fd 経由で権限を締める。パス指定の chmod は、検証した対象と
   * 実際に書き換える対象がずれうる（間に差し替えられる）ため fd で行う。
   */
  private hardenPath(target: string, mode: number): void {
    let fd: number;
    try {
      fd = fs.openSync(target, fs.constants.O_RDONLY);
    } catch (err) {
      // ディレクトリを open できないプラットフォーム（Windows: EISDIR/EPERM）は
      // パス指定にフォールバックする。権限を締められないこと自体は許容しない。
      const code = (err as NodeJS.ErrnoException).code;
      if (mode === CONFIG_DIR_MODE && (code === 'EISDIR' || code === 'EPERM' || code === 'EACCES')) {
        const previous = fs.statSync(target).mode & 0o7777;
        fs.chmodSync(target, mode);
        this.warnRepaired(previous, mode);
        return;
      }
      throw err;
    }
    try {
      this.hardenPermissions(fd, mode);
    } finally {
      fs.closeSync(fd);
    }
  }

  /** 既存の権限を締めたときは、黙って直さず 1 行警告する（stderr のみ）。 */
  private warnRepaired(previousMode: number, mode: number): void {
    if (previousMode === mode) return;
    console.error(
      `[mf-mcp] 保存先の権限を ${previousMode.toString(8)} から ${mode.toString(8)} に修正しました。`
    );
  }

  private hardenPermissions(fd: number, mode: number): void {
    const previousMode = fs.fstatSync(fd).mode & 0o7777;
    fs.fchmodSync(fd, mode);
    this.warnRepaired(previousMode, mode);
  }

  /** Migrate tokens from legacy path to new path (invoice only) */
  private migrateTokens(): void {
    if (this.config.name !== 'invoice') return;
    const newPath = this.config.storage.tokensFile;
    const legacyPath = getLegacyTokensFile();
    if (fs.existsSync(newPath)) return;
    if (!fs.existsSync(legacyPath)) return;

    // 移行元の権限は hardenExistingStorage で既に締めてある。
    // copyFileSync は元のモードを引き継ぐため使わず、fd 経由で書き出す。
    // 失敗は握り潰さない（黙って緩いコピーが残るより、起動を止めるほうが安全）。
    this.writeTokenFile(fs.readFileSync(legacyPath, 'utf-8'));
  }

  private ensureConfigDir(): void {
    const dir = path.dirname(this.config.storage.tokensFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: CONFIG_DIR_MODE });
    }
    this.hardenPath(dir, CONFIG_DIR_MODE);
  }

  /**
   * トークンファイルを書く。**fd を 0600 にしてから中身を書く**。
   * パスに書いてから chmod すると、その間だけ緩いファイルに秘密が存在する。
   */
  private writeTokenFile(data: string): void {
    this.ensureConfigDir();
    const fd = fs.openSync(
      this.config.storage.tokensFile,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC,
      TOKEN_FILE_MODE
    );
    try {
      this.hardenPermissions(fd, TOKEN_FILE_MODE);
      fs.writeFileSync(fd, data, 'utf-8');
    } finally {
      fs.closeSync(fd);
    }
  }

  private loadTokens(): void {
    try {
      const tokensFile = this.config.storage.tokensFile;
      if (fs.existsSync(tokensFile)) {
        const data = fs.readFileSync(tokensFile, 'utf-8');
        this.tokens = JSON.parse(data);
      }
    } catch {
      this.tokens = null;
    }
  }

  private saveTokens(tokens: OAuthTokens): void {
    // Add expiration timestamp
    tokens.expires_at = Date.now() + tokens.expires_in * 1000;
    // 保存に失敗したのに「認証済み」になると、次回起動で消えるトークンを
    // 使い続けることになる。書けたときだけメモリを更新する。
    this.writeTokenFile(JSON.stringify(tokens, null, 2));
    this.tokens = tokens;
  }

  private isOobMode(): boolean {
    return !process.env.MF_REDIRECT_URI || process.env.MF_REDIRECT_URI === OOB_REDIRECT_URI;
  }

  getRedirectUri(): string {
    if (this.isOobMode()) {
      return OOB_REDIRECT_URI;
    }
    return validateRedirectUri(process.env.MF_REDIRECT_URI as string, this.port);
  }

  getAuthorizationUrl(state?: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.oauth.clientId,
      redirect_uri: this.getRedirectUri(),
      scope: this.config.oauth.scopes,
    });
    if (state) {
      params.set('state', state);
    }
    return `${this.config.oauth.authorizeUrl}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<OAuthTokens> {
    const tokens = await this.requestTokens(code);
    this.saveTokens(tokens);
    return tokens;
  }

  /**
   * 認可コードをトークンに交換する。**保存はしない。**
   *
   * 保存と分けてあるのは、コールバック経路で「交換している間にフローが
   * 差し替えられた／タイムアウトした」場合に、**古いトークンを新しい認証の上に
   * 上書きさせない**ため。保存直前に世代を確認する必要がある。
   */
  private async requestTokens(code: string): Promise<OAuthTokens> {
    const response = await fetch(this.config.oauth.tokenUrl, {
      method: 'POST',
      // client_secret を載せるので、リダイレクト先への転送は許さない
      redirect: 'error',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: this.config.oauth.clientId,
        client_secret: this.config.oauth.clientSecret,
        redirect_uri: this.getRedirectUri(),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return await response.json() as OAuthTokens;
  }

  async refreshToken(): Promise<OAuthTokens> {
    if (!this.tokens?.refresh_token) {
      throw new Error('No refresh token available. Please re-authenticate.');
    }

    const response = await fetch(this.config.oauth.tokenUrl, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.tokens.refresh_token,
        client_id: this.config.oauth.clientId,
        client_secret: this.config.oauth.clientSecret,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed: ${error}`);
    }

    const tokens = await response.json() as OAuthTokens;
    this.saveTokens(tokens);
    return tokens;
  }

  async getAccessToken(): Promise<string> {
    if (!this.tokens) {
      throw new Error(`Not authenticated. Please run mf_${this.config.name === 'invoice' ? '' : 'expense_'}auth_start first.`);
    }

    // Check if token is expired (with 5 minute buffer)
    const expiresAt = this.tokens.expires_at || 0;
    if (Date.now() > expiresAt - 5 * 60 * 1000) {
      await this.refreshToken();
    }

    return this.tokens.access_token;
  }

  isAuthenticated(): boolean {
    return this.tokens !== null;
  }

  getAuthStatus(): { authenticated: boolean; expiresAt?: number } {
    if (!this.tokens) {
      return { authenticated: false };
    }
    return {
      authenticated: true,
      expiresAt: this.tokens.expires_at,
    };
  }

  clearTokens(): void {
    this.tokens = null;
    const tokensFile = this.config.storage.tokensFile;
    if (fs.existsSync(tokensFile)) {
      fs.unlinkSync(tokensFile);
    }
  }

  getServiceName(): string {
    return this.config.name;
  }

  /** テスト用。listen 中のアドレスを返す。 */
  getServerAddresses(): { address: string; port: number }[] {
    return (this.pending?.servers ?? [])
      .map((server) => server.address())
      .filter((addr): addr is import('node:net').AddressInfo => !!addr && typeof addr !== 'string')
      .map((addr) => ({ address: addr.address, port: addr.port }));
  }

  /** テスト用。コールバック待ちが生きているか。 */
  hasPendingFlow(): boolean {
    return this.pending !== null;
  }

  /**
   * OOBモード: 認証URLを返すのみ。ユーザーがブラウザで認可後、
   * 画面に表示されるコードを mf_auth_callback で入力する。
   * state パラメータも付与する（OOB でも CSRF 抑止の慣例）。
   */
  startOobFlow(): { authUrl: string; state: string } {
    const state = crypto.randomBytes(16).toString('hex');
    return { authUrl: this.getAuthorizationUrl(state), state };
  }

  /** 進行中のフローを終了させる。差し替え・タイムアウト・完了で共通に使う。 */
  private finishFlow(flow: PendingFlow, result: { tokens?: OAuthTokens; error?: Error }): void {
    if (this.pending?.generation === flow.generation) {
      this.pending = null;
    }
    clearTimeout(flow.timeoutId);
    for (const server of flow.servers) {
      // keep-alive のソケットが残るとポートが解放されず、次のフローが
      // EADDRINUSE になる。明示的に切る。
      server.closeAllConnections?.();
      server.close();
    }
    if (currentlyAuthenticatingService === this.config.name) {
      currentlyAuthenticatingService = null;
    }
    flow.settle(result);
  }

  /**
   * ローカルサーバーモード: コールバックサーバーを起動して自動でコードを受け取る。
   * MF_REDIRECT_URI=http://127.0.0.1:38080/callback の場合に使用。
   *
   * 同時に複数サービスが起動しないようモジュールレベルでロックする。別サービスが
   * 認証中なら即座にエラーを投げる。同一サービスの再呼び出しは、前のフローの
   * タイマーとサーバーを必ず片付けてから差し替える（古いタイマーが新しい
   * listener を閉じてしまう事故を防ぐ）。
   */
  async startCallbackServerFlow(): Promise<{ authUrl: string; tokenPromise: Promise<OAuthTokens> }> {
    const redirectUri = this.getRedirectUri();
    if (redirectUri === OOB_REDIRECT_URI) {
      throw new Error('コールバック方式では MF_REDIRECT_URI にループバック URL を指定してください。');
    }
    const redirectHost = new URL(redirectUri).hostname;
    const requiredHosts = redirectHost === 'localhost'
      ? [PRIMARY_LOOPBACK_HOST, SECONDARY_LOOPBACK_HOST]
      : [redirectHost === '[::1]' ? SECONDARY_LOOPBACK_HOST : PRIMARY_LOOPBACK_HOST];

    if (
      currentlyAuthenticatingService !== null
      && currentlyAuthenticatingService !== this.config.name
    ) {
      throw new Error(
        `別サービス (${currentlyAuthenticatingService}) のOAuthフローが進行中です。`
        + `完了またはタイムアウト後に再度お試しください。`
      );
    }

    // 同サービスの再呼び出し: 前のフローをエラーで確定させて片付ける
    if (this.pending) {
      this.finishFlow(this.pending, {
        error: new Error('新しい認証フローが開始されたため、前の認証フローを中止しました'),
      });
    }

    const state = crypto.randomBytes(16).toString('hex');
    const generation = ++this.generationCounter;
    currentlyAuthenticatingService = this.config.name;

    // listen 失敗（ポート使用中など）は authUrl を返す前に検出する
    const servers: http.Server[] = [];
    try {
      for (const host of requiredHosts) {
        servers.push(await this.listenLoopback(host));
      }
    } catch (err) {
      if (currentlyAuthenticatingService === this.config.name) {
        currentlyAuthenticatingService = null;
      }
      for (const server of servers) {
        server.closeAllConnections?.();
        server.close();
      }
      throw err;
    }

    let settle!: (result: { tokens?: OAuthTokens; error?: Error }) => void;
    const tokenPromise = new Promise<OAuthTokens>((resolve, reject) => {
      settle = (result) => {
        if (result.tokens) resolve(result.tokens);
        else reject(result.error ?? new Error('認証が完了しませんでした'));
      };
    });

    const timeoutId = setTimeout(() => {
      const flow = this.pending;
      if (flow && flow.generation === generation) {
        this.finishFlow(flow, { error: new Error('認証がタイムアウトしました（5分）') });
      }
    }, AUTH_TIMEOUT_MS);

    const flow: PendingFlow = {
      generation, state, timeoutId, servers, consumed: false, settle,
    };
    this.pending = flow;

    for (const server of servers) {
      server.on('request', (req, res) => {
        // handleCallbackRequest の中で投げられた例外（`//[` のような不正な
        // リクエストターゲットで URL の構築が失敗する等）を受け止める。
        // 未処理の rejection は Node の既定で**プロセスを終了させる** =
        // 認証していない第三者が MCP サーバーを落とせることになる。
        this.handleCallbackRequest(req, res, flow).catch((err) => {
          // URL の内容はログに出さない（state や code が混じりうる）。
          console.error(
            `[mf-mcp] 不正なコールバックリクエストを無視しました: `
              + `${err instanceof Error ? err.name : 'Error'}`
          );
          try {
            if (!res.headersSent) {
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', 'Connection': 'close' });
            }
            res.end('<html><body><h1>エラー</h1><p>リクエストを解釈できませんでした。</p></body></html>');
          } catch {
            // レスポンスも書けない状態なら何もしない
          }
          // 進行中のフローには触らない。state 検証を通っていないリクエストで
          // 認証を中断させてはならない。
        });
      });
    }

    return { authUrl: this.getAuthorizationUrl(state), tokenPromise };
  }

  /**
   * 必須のループバックアドレスで listen する。失敗したら、どう直すかを添えて投げる。
   */
  private async listenLoopback(host: string): Promise<http.Server> {
    const server = http.createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: NodeJS.ErrnoException) => {
          server.removeListener('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          server.removeListener('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(this.port, host);
      });
      return server;
    } catch (err) {
      server.close();
      const hint = (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
        ? '使用中のアプリを終了するか、MF_CALLBACK_PORT と MF_REDIRECT_URI を同じ空きポートに変更してください。'
        : 'MF_REDIRECT_URI のホストを、この PC で使える 127.0.0.1 または [::1] に変更してください。';
      throw new Error(
        `コールバックサーバーの起動に失敗しました（ホスト ${host}、ポート ${this.port}）: ${hint}`
          + 'MoneyForward のアプリ設定のリダイレクト URI も同じ値に変更してください。'
      );
    }
  }

  /**
   * コールバックリクエストを処理する。
   *
   * **検証順が重要**: state を最初に検証する。state が合わないリクエスト（LAN の
   * 他ホストや、ブラウザの別タブから飛んできたもの）は 400 を返すだけで、
   * 進行中のフローには一切触らない。`error` を先に見ると、state を知らない
   * 第三者が `?error=access_denied` を投げるだけでフローを落とせてしまう。
   */
  private async handleCallbackRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    flow: PendingFlow,
  ): Promise<void> {
    const url = new URL(req.url || '', `http://${PRIMARY_LOOPBACK_HOST}:${this.port}`);

    if (url.pathname !== '/callback') {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    // 1. state の検証が最優先。不一致・欠落はフローに触らずに拒否する。
    if (!statesMatch(url.searchParams.get('state'), flow.state)) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', 'Connection': 'close' });
      res.end('<html><body><h1>認証エラー</h1><p>state パラメータの不一致</p></body></html>');
      return;
    }

    // 2. 受け付けるコールバックは 1 回だけ。
    if (flow.consumed || this.pending?.generation !== flow.generation) {
      res.writeHead(409, { 'Content-Type': 'text/html; charset=utf-8', 'Connection': 'close' });
      res.end('<html><body><h1>認証エラー</h1><p>この認証フローは既に処理済みです。</p></body></html>');
      return;
    }
    flow.consumed = true;

    // 3. state が正しいコールバックに限り、OAuth エラーを受け付ける。
    const oauthError = url.searchParams.get('error');
    if (oauthError) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', 'Connection': 'close' });
      res.end(`<html><body><h1>認証エラー</h1><p>${escapeHtml(oauthError)}</p></body></html>`);
      this.finishFlow(flow, { error: new Error(`OAuth error: ${oauthError}`) });
      return;
    }

    const code = url.searchParams.get('code');
    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', 'Connection': 'close' });
      res.end('<html><body><h1>エラー</h1><p>認証コードがありません</p></body></html>');
      this.finishFlow(flow, { error: new Error('認証コードがありません') });
      return;
    }

    try {
      const tokens = await this.requestTokens(code);

      // 交換の最中にフローが差し替えられた／タイムアウトしている可能性がある。
      // **保存の直前に**世代を確認する。古い応答を保存すると、新しい認証で
      // 取得したトークンを上書きしてしまう。
      if (this.pending?.generation !== flow.generation) {
        console.error(
          '[mf-mcp] 中止された認証フローのトークンを受け取ったため破棄しました。'
            + '（新しい認証フローの結果は保持されます）'
        );
        res.writeHead(409, { 'Content-Type': 'text/html; charset=utf-8', 'Connection': 'close' });
        res.end('<html><body><h1>認証エラー</h1><p>この認証フローは中止されています。</p></body></html>');
        return;
      }

      this.saveTokens(tokens);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Connection': 'close' });
      res.end('<html><body><h1>認証成功</h1><p>このウィンドウを閉じてください。</p></body></html>');
      this.finishFlow(flow, { tokens });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8', 'Connection': 'close' });
      res.end(`<html><body><h1>トークン取得エラー</h1><p>${escapeHtml(message)}</p></body></html>`);
      if (this.pending?.generation === flow.generation) {
        this.finishFlow(flow, { error: err instanceof Error ? err : new Error(message) });
      }
    }
  }

  stopServer(): void {
    if (this.pending) {
      this.finishFlow(this.pending, { error: new Error('認証フローを停止しました') });
    }
  }
}
