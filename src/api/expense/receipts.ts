import { pathParam } from '../path.js';
import { getExpenseClient } from '../client.js';
import type { UploadReceiptResponse } from '../../types/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/** レシートとして送れる拡張子。これ以外は送信前に拒否する。 */
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.heic', '.heif', '.pdf'];

/** 1 ファイルの上限。MF 側の上限に依らず、巨大ファイルの送信自体を防ぐ。 */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * アップロードを拒否するパス。認証情報が置かれる場所。
 * ディレクトリと単体ファイルの両方を挙げる。
 */
function deniedPaths(): string[] {
  const home = os.homedir();
  return [
    path.join(home, '.config'),        // mf-mcp / mf-invoice-mcp のトークンキャッシュを含む
    path.join(home, '.claude'),
    path.join(home, '.claude.json'),   // MCP の env（client secret）が平文で入る
    path.join(home, '.ssh'),
    path.join(home, '.aws'),
    path.join(home, '.gnupg'),
  ];
}

/**
 * `child` が `parent` と同じか、その配下かを判定する。
 *
 * 両辺の symlink を解決してから比較する。解決しないと、macOS のように
 * home 自体が symlink 配下にある環境（`/var` → `/private/var`）で
 * 実パスと組み立てたパスが一致せず、**拒否すべきファイルを通してしまう**。
 */
function isInside(resolvedChild: string, parent: string): boolean {
  const candidates = new Set([parent]);
  try {
    candidates.add(fs.realpathSync(parent));
  } catch {
    // 存在しないなら組み立てたパスだけで比較する
  }
  for (const base of candidates) {
    const rel = path.relative(base, resolvedChild);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return true;
  }
  return false;
}

/**
 * アップロード対象のファイルを検証する。
 *
 * このツールは呼び出し側が渡した任意のパスを読んで送信する。AI が取り違えれば
 * `~/.config/mf-mcp/invoice-tokens.json` のような認証情報を外部へ送ってしまう。
 * パーミッション 0600 は防御にならない（コネクタ自身が所有者として読める）。
 *
 * 検証の順序は固定:
 *   1. realpath で解決する（symlink 経由の回避を潰す）
 *   2. 認証情報ディレクトリの配下なら拒否する
 *   3. 拡張子が許可リストに無ければ拒否する
 *   4. サイズ上限を超えていれば拒否する
 *
 * 画像の中身は見ない。同一マシン上の敵対的プロセスによる hardlink や
 * stat→read の競合も対象外（ユーザー自身の権限で動くローカルサーバーである）。
 *
 * 解決済みの実パスを返す。
 */
export function resolveReceiptPath(filePath: string): string {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new Error('file_path が空です');
  }

  // 1. symlink を解決した実体で判断する
  let resolved: string;
  try {
    resolved = fs.realpathSync(filePath);
  } catch {
    throw new Error(`ファイルが見つかりません: ${filePath}`);
  }

  // 2. 認証情報の置き場は拒否する
  for (const denied of deniedPaths()) {
    if (isInside(resolved, denied)) {
      throw new Error(
        `認証情報が置かれる場所のファイルはアップロードできません: ${denied} 配下`
      );
    }
  }

  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`通常のファイルではありません: ${filePath}`);
  }

  // 3. 拡張子（MF 側の拒否は送信後なので手遅れ）
  const ext = path.extname(resolved).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(
      `レシートとして送れる拡張子ではありません: ${ext || '(拡張子なし)'}`
        + `（許可: ${ALLOWED_EXTENSIONS.join(', ')}）`
    );
  }

  // 4. サイズ
  if (stat.size === 0) {
    throw new Error(`ファイルが空です: ${filePath}`);
  }
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(
      `ファイルが大きすぎます（${Math.round(stat.size / 1024 / 1024)}MB、上限 ${MAX_FILE_BYTES / 1024 / 1024}MB）`
    );
  }

  return resolved;
}

export async function uploadReceipt(officeId: string, filePath: string): Promise<UploadReceiptResponse> {
  // 検証は必ずここで行う。ツール側だけに置くと、別の呼び出し経路が素通りする。
  const resolved = resolveReceiptPath(filePath);
  const fileBuffer = fs.readFileSync(resolved);
  const fileName = path.basename(resolved);

  const formData = new FormData();
  const blob = new Blob([fileBuffer]);
  formData.append('receipt[file]', blob, fileName);

  return getExpenseClient().postFormData<UploadReceiptResponse>(
    `/offices/${pathParam(officeId, 'office_id')}/me/upload_receipt`,
    formData
  );
}
