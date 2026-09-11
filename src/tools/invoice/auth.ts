import { z } from 'zod';
import { getOAuthManager } from '../../auth/registry.js';

export const authTools = {
  mf_auth_status: {
    description: '認証状態を確認します',
    inputSchema: z.object({}),
    handler: async () => {
      try {
        const oauthManager = getOAuthManager('invoice');
        const status = oauthManager.getAuthStatus();

        if (status.authenticated) {
          const expiresAt = status.expiresAt
            ? new Date(status.expiresAt).toISOString()
            : 'unknown';
          return {
            content: [
              {
                type: 'text' as const,
                text: `認証済み\nトークン有効期限: ${expiresAt}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: '未認証です。mf_auth_startを実行して認証を開始してください。',
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

  mf_auth_start: {
    description: 'OAuth認証を開始します。デフォルトはOOBモード（認証コードが画面に表示される）。MF_REDIRECT_URIにlocalhost URLを設定するとコールバックサーバーモードになります。',
    inputSchema: z.object({
      wait: z.boolean().optional().describe('後方互換のため受け付けるが無視する。認証 URL は常に即座に返す（URL を返す前に待つと、ユーザーが認可できずタイムアウトするため）'),
    }),
    handler: async (args: { wait?: boolean }) => {
      try {
        const oauthManager = getOAuthManager('invoice');
        const redirectUri = oauthManager.getRedirectUri();
        const isOob = redirectUri === 'urn:ietf:wg:oauth:2.0:oob';

        if (isOob) {
          // OOBモード: URLを返してユーザーにコードを入力してもらう
          const { authUrl } = oauthManager.startOobFlow();
          return {
            content: [
              {
                type: 'text' as const,
                text: `以下のURLをブラウザで開いて認証してください:\n${authUrl}\n\n認証後に画面に表示されるコードを mf_auth_callback の code パラメータに入力してください。`,
              },
            ],
          };
        }

        // コールバックサーバーモード
        const { authUrl, tokenPromise } = await oauthManager.startCallbackServerFlow();
        // tokenPromise は必ず handle する。未処理の rejection（タイムアウト・
        // 認可拒否・state 不一致）で Node プロセスごと落ちるのを防ぐ。
        // 結果は tokens ファイルに保存されるので、完了確認は mf_auth_status で行う。
        void tokenPromise.catch(() => {
          // 失敗してもここでは何もしない。状態は tokens ファイルが正で、
          // ユーザーは *_auth_status で確認する。
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: `認証サーバーを起動しました (ポート: ${process.env.MF_CALLBACK_PORT || '38080'})\n\n以下のURLをブラウザで開いて認証してください:\n${authUrl}\n\n認証が完了すると自動的にトークンが保存されます。完了の確認は mf_auth_status を実行してください。`,
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

  mf_auth_callback: {
    description: '認証コードを使用してアクセストークンを取得します（OOBモードで認証後に使用）',
    inputSchema: z.object({
      code: z.string().describe('認可後に取得した認証コード'),
    }),
    handler: async (args: { code: string }) => {
      try {
        const oauthManager = getOAuthManager('invoice');
        await oauthManager.exchangeCode(args.code);

        return {
          content: [
            {
              type: 'text' as const,
              text: '認証が完了しました。MoneyForward クラウド請求書 APIを使用できます。',
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

  mf_refresh_token: {
    description: 'アクセストークンをリフレッシュします',
    inputSchema: z.object({}),
    handler: async () => {
      try {
        const oauthManager = getOAuthManager('invoice');
        await oauthManager.refreshToken();

        return {
          content: [
            {
              type: 'text' as const,
              text: 'トークンを更新しました。',
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
