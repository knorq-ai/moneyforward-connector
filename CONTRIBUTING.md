# 開発への参加ガイド

## 開発環境のセットアップ

```bash
git clone https://github.com/knorq-ai/moneyforward-connector.git
cd moneyforward-connector
npm install
```

Node.js 20 以上が必要。

## ビルド

```bash
npm run build
```

## 新しいツールの追加方法

ツールは `src/{api,tools}/<service>/` の 3 プロダクト構成（`invoice` / `expense` / `accounting`）に分かれている。追加先のプロダクトを決めてから作業する。

### 1. 型定義の追加

型の置き場はプロダクトごとに分かれている。請求書系は `src/types/index.ts`、経費系は `src/types/expense.ts`、会計系は `src/types/accounting.ts`:

```typescript
export interface NewResource {
  id: string;
  name: string;
  // ...
}

export interface CreateNewResourceParams {
  name: string;
  // ...
}
```

### 2. API関数の追加

`src/api/<service>/new-resource.ts` を作成。API クライアントはプロダクト別のファクトリから取得する（`getInvoiceClient` / `getExpenseClient` / `getAccountingClient`）:

```typescript
import { getInvoiceClient } from '../client.js';
import type { NewResource, CreateNewResourceParams, ListResponse } from '../../types/index.js';

export async function listNewResources(): Promise<ListResponse<NewResource>> {
  return getInvoiceClient().get<ListResponse<NewResource>>('/new_resources');
}

export async function createNewResource(params: CreateNewResourceParams): Promise<NewResource> {
  return getInvoiceClient().post<NewResource>('/new_resources', params);
}
```

リクエストボディのラップ形（`{ new_resource: ... }`）は**エンドポイントごとに違う**。請求書 v3 の多くはトップレベルに置く。実際のレスポンスで確認すること。

**URL に ID を埋めるときは必ず `pathParam()` を通す**（`src/api/path.ts`）。テンプレートリテラルに生の ID を入れると、`123/disapprove#` のような値で別のエンドポイントへリクエストが飛ぶ。

```typescript
import { pathParam } from '../path.js';

export async function getNewResource(id: string): Promise<NewResource> {
  return getInvoiceClient().get<NewResource>(`/new_resources/${pathParam(id, 'new_resource_id')}`);
}
```

### 3. MCPツールの追加

`src/tools/<service>/new-resource.ts` を作成:

```typescript
import { z } from 'zod';
import { listNewResources, createNewResource } from '../../api/invoice/new-resource.js';

export const newResourceTools = {
  mf_list_new_resources: {
    description: '新リソース一覧を取得します',
    inputSchema: z.object({
      page: z.number().optional().describe('ページ番号'),
    }),
    handler: async (args: { page?: number }) => {
      try {
        const result = await listNewResources();
        return {
          content: [
            {
              type: 'text' as const,
              text: `一覧: ${JSON.stringify(result.data, null, 2)}`,
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
          // 失敗を成功として返さない。これが無いと、MCP のエラー状態を見て
          // 分岐するワークフローが「書き込みが失敗した」ことに気付けない。
          isError: true,
        };
      }
    },
  },
};
```

### 4. エントリポイントへの登録

`src/index.ts` を編集:

```typescript
import { newResourceTools } from './tools/invoice/new-resource.js';

const allTools = {
  ...authTools,
  ...partnerTools,
  // ...
  ...newResourceTools,  // 追加
};
```

## コーディング規約

- TypeScript strict modeを使用
- zodでinputSchemaを定義
- エラーハンドリングは各ハンドラー内でtry-catch
- 日本語のユーザー向けメッセージ
- **認証情報をコードに書かない。** client id / secret は環境変数から読む（`src/config.ts`）
- **トークンや `Authorization` ヘッダをログ・エラー文・ツール結果に出さない**
- 不可逆な操作には確認フラグを付ける（`mf_accounting_delete_journal` の `confirm` が例）。
  書き込みツールには `dry_run` を検討する
- **catch した失敗は必ず `isError: true` を付けて返す**
- **URL に入る ID は `pathParam()` を通す**
- 複数ステップの破壊的な操作は、**最初の 1 件を壊す前に**全体を検証する
  （`replaceBillingItems` が例。検証前に削除を始めると明細が消えた請求書が残る）

## テスト方法

1. ビルド: `npm run build`
2. ユニットテスト: `npm test`（`test/*.test.mjs`、`node --test`。認証情報は不要）
3. スモークテスト: `npm run smoke`
   認証情報は不要。stdio でハンドシェイクし、`tools/list` が妥当なスキーマ付きで
   全ツールを返すことを検証する。ツールを追加したら `scripts/smoke.mjs` の
   `REQUIRED_TOOLS` を必要に応じて更新する
4. 実 API での確認: 環境変数を設定してMCPクライアントから接続し、ツールを実行する
   **secret をコマンドラインに直接書かない**（シェル履歴に残る）。対話入力で読む:
   ```bash
   # zsh では `read -p` が動かないので、プロンプトは printf で出す
   printf 'client ID: ';     read -r  MF_INVOICE_CLIENT_ID
   printf 'client secret: '; read -rs MF_INVOICE_CLIENT_SECRET; echo
   export MF_INVOICE_CLIENT_ID MF_INVOICE_CLIENT_SECRET
   ```
   **本番の帳簿で試さないこと。** 書き込み系を試すときは、削除・更新の影響範囲を
   先に確認する

## コミットメッセージ

```
feat: 新機能の追加
fix: バグ修正
docs: ドキュメントのみの変更
refactor: リファクタリング
```

## プルリクエスト

1. フォークしてブランチを作成
2. 変更を実装
3. `npm run build` / `npm test` / `npm run smoke` が通ることを確認
4. 実値（client id / secret / トークン / 事業者固有の ID / 取引先名）を差分に
   含めていないことを確認
5. プルリクエストを作成

API の挙動が仕様書と違っていた場合は、`CLAUDE.md` の該当節か
`docs/accounting-operational-notes.md` に書き残すと次の人が助かる。
