import { z } from 'zod';
import { getOAuthManager } from '../../auth/registry.js';

export const accountingAuthTools = {
  mf_accounting_auth_start: {
    description: '会計API OAuth認証を開始する。デフォルトはOOBモード（認証コードが画面に表示される）。',
    inputSchema: z.object({
      wait: z.boolean().optional().describe('後方互換のため受け付けるが無視する。認証 URL は常に即座に返す（URL を返す前に待つと、ユーザーが認可できずタイムアウトするため）'),
    }),
    handler: async (args: { wait?: boolean }) => {
      try {
        const oauthManager = getOAuthManager('accounting');
        const redirectUri = oauthManager.getRedirectUri();
        const isOob = redirectUri === 'urn:ietf:wg:oauth:2.0:oob';

        if (isOob) {
          const { authUrl } = oauthManager.startOobFlow();
          return {
            content: [
              {
                type: 'text' as const,
                text: `以下のURLをブラウザで開いて会計API認証してください:\n${authUrl}\n\n認証後に画面に表示されるコードを mf_accounting_auth_callback の code パラメータに入力してください。`,
              },
            ],
          };
        }

        // コールバックサーバーモード
        const { authUrl, tokenPromise } = await oauthManager.startCallbackServerFlow();
        // tokenPromise は必ず handle する。未処理の rejection（タイムアウト・
        // 認可拒否・state 不一致）で Node プロセスごと落ちるのを防ぐ。
        // 結果は tokens ファイルに保存されるので、完了確認は mf_accounting_auth_status で行う。
        void tokenPromise.catch(() => {
          // 失敗してもここでは何もしない。状態は tokens ファイルが正で、
          // ユーザーは *_auth_status で確認する。
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: `会計API認証サーバーを起動した (ポート: ${process.env.MF_CALLBACK_PORT || '38080'})\n\n以下のURLをブラウザで開いて認証してください:\n${authUrl}\n\n認証が完了すると自動的にトークンが保存される。完了の確認は mf_accounting_auth_status を実行すること。`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `エラー: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  mf_accounting_auth_status: {
    description: '会計API認証状態を確認する',
    inputSchema: z.object({}),
    handler: async () => {
      try {
        const oauthManager = getOAuthManager('accounting');
        const status = oauthManager.getAuthStatus();

        if (status.authenticated) {
          const expiresAt = status.expiresAt
            ? new Date(status.expiresAt).toISOString()
            : 'unknown';
          return {
            content: [
              {
                type: 'text' as const,
                text: `会計API: 認証済み\nトークン有効期限: ${expiresAt}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: '会計API: 未認証。mf_accounting_auth_startを実行して認証を開始してください。',
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `エラー: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  mf_accounting_auth_callback: {
    description: '会計API認証コードを使用してアクセストークンを取得する（OOBモードで認証後に使用）',
    inputSchema: z.object({
      code: z.string().describe('認可後に取得した認証コード'),
    }),
    handler: async (args: { code: string }) => {
      try {
        const oauthManager = getOAuthManager('accounting');
        await oauthManager.exchangeCode(args.code);

        return {
          content: [
            {
              type: 'text' as const,
              text: '認証が完了した。MoneyForward クラウド会計 APIを使用できる。',
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `認証エラー: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  mf_accounting_refresh_token: {
    description: '会計API アクセストークンをリフレッシュする',
    inputSchema: z.object({}),
    handler: async () => {
      try {
        const oauthManager = getOAuthManager('accounting');
        await oauthManager.refreshToken();

        return {
          content: [
            {
              type: 'text' as const,
              text: 'トークンを更新した。',
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `トークン更新エラー: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  },
};
