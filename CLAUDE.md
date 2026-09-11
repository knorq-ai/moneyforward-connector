# moneyforward-connector 開発ガイド

このファイルはClaude Code向けのプロジェクト固有の指示です。

## プロジェクト概要

MoneyForward クラウド請求書 API v3 + クラウド経費 API + クラウド会計 API v3 を統合した
stdio 型 MCP サーバー。計 56 ツール（請求書 23 / 経費 17 / 会計 16）。

**位置付け**: クラウド会計・確定申告には公式のリモート MCP サーバーがあり、会計だけなら
公式を使うべきである（README 参照）。本リポジトリの存在理由は公式 MCP 対象外の
**クラウド請求書・クラウド経費**であり、会計モジュールは OAuth を 1 系統で済ませたい
場合と、公式に無い仕訳削除・dry-run のために残してある。

> **注意**: v3 APIでは納品書作成エンドポイントが提供されていません。納品書が必要な場合はマネーフォワードのWebUIで作成してください。

## アーキテクチャ

```
src/
├── index.ts                     # MCPサーバーエントリポイント（全ツール登録）
├── config.ts                    # サービス設定の一元管理
├── auth/
│   ├── oauth.ts                 # OAuth 2.0認証（パラメータ化）
│   └── registry.ts              # サービス名 → OAuthManager マッピング
├── api/
│   ├── client.ts                # 共通APIクライアント（パラメータ化）
│   ├── rate-limiter.ts          # レート制限（共有インスタンス）
│   ├── invoice/                 # 請求書APIモジュール
│   │   ├── partners.ts
│   │   ├── items.ts
│   │   ├── quotes.ts
│   │   ├── billings.ts
│   │   └── delivery.ts
│   ├── expense/                 # 経費APIモジュール
│   │   ├── offices.ts
│   │   ├── transactions.ts
│   │   ├── reports.ts
│   │   ├── receipts.ts
│   │   └── master.ts
│   └── accounting/              # 会計APIモジュール
│       ├── journals.ts
│       ├── accounts.ts
│       ├── taxes.ts
│       ├── departments.ts
│       ├── offices.ts
│       └── trade_partners.ts
├── tools/
│   ├── invoice/                 # 請求書ツール
│   │   ├── auth.ts
│   │   ├── partners.ts
│   │   ├── items.ts
│   │   ├── quotes.ts
│   │   ├── billings.ts
│   │   └── delivery.ts
│   ├── expense/                 # 経費ツール
│   │   ├── auth.ts
│   │   ├── offices.ts
│   │   ├── transactions.ts
│   │   ├── reports.ts
│   │   ├── receipts.ts
│   │   └── master.ts
│   └── accounting/              # 会計ツール
│       ├── auth.ts
│       ├── journals.ts
│       ├── accounts.ts
│       ├── taxes.ts
│       ├── departments.ts
│       ├── offices.ts
│       └── trade_partners.ts
└── types/
    ├── index.ts                 # 型 re-export
    ├── common.ts                # 共通型（OAuth, Pagination, ApiError）
    ├── expense.ts               # 経費API型定義
    └── accounting.ts            # 会計API型定義
```

リポジトリ直下:

```
docs/tools.md                    # 公開用ツール一覧（README から分離）
docs/accounting-operational-notes.md  # 会計 API/UI 運用で判明した非自明な挙動
scripts/smoke.mjs                # stdio ハンドシェイク + tools/list のスモークテスト
```

## デュアルAPI設計

### 認証の分離
- 請求書 / 経費 / 会計 API はそれぞれ別のOAuthクライアントキーを使用
- `auth/registry.ts` がサービス名（'invoice' | 'expense' | 'accounting'）でOAuthManagerを遅延生成・キャッシュ
- トークンは別ファイルに保存（いずれも **mode 0600**、ディレクトリは 0700）:
  - 請求書: `~/.config/mf-mcp/invoice-tokens.json`
  - 経費: `~/.config/mf-mcp/expense-tokens.json`
  - 会計: `~/.config/mf-mcp/accounting-tokens.json`
- 旧パス `~/.config/mf-invoice-mcp/tokens.json` からの自動マイグレーション対応（invoice のみ）
- 同時に複数サービスが `auth_start` を呼ぶとコールバックポートが衝突するため、
  モジュールレベルのロックで逐次化している（`oauth.ts`）

### 環境変数
| 変数 | 用途 | 備考 |
|------|------|------|
| MF_INVOICE_CLIENT_ID | 請求書APIクライアントID | MF_CLIENT_IDでも可（後方互換） |
| MF_INVOICE_CLIENT_SECRET | 請求書APIシークレット | MF_CLIENT_SECRETでも可 |
| MF_EXPENSE_CLIENT_ID | 経費APIクライアントID | |
| MF_EXPENSE_CLIENT_SECRET | 経費APIシークレット | |
| MF_ACCOUNTING_CLIENT_ID | 会計APIクライアントID | |
| MF_ACCOUNTING_CLIENT_SECRET | 会計APIシークレット | |
| MF_REDIRECT_URI | OAuthリダイレクトURI | 未設定ならOOBモード。localhost URLを設定するとコールバックサーバーモード |
| MF_CALLBACK_PORT | OAuthコールバックポート | デフォルト38080、共有 |

**値をコードに書かない。** すべて環境変数から読む（`config.ts`）。トークン・
`Authorization` ヘッダをログ・エラー文・ツール結果に出さないこと。

## MoneyForward Invoice API v3 仕様

### ベースURL
`https://invoice.moneyforward.com/api/v3/`

### 認証
- OAuth 2.0 Authorization Code Flow
- 認可URL: `https://api.biz.moneyforward.com/authorize`
- トークンURL: `https://api.biz.moneyforward.com/token`
- スコープ: `mfc/invoice/data.read mfc/invoice/data.write`
- リダイレクトURI: `http://localhost:38080/callback`

### インボイス制度対応
- **department_id**: 取引先の部門ID（`/partners/{id}/departments`で取得）
- **excise**: 消費税区分（`ten_percent`, `eight_percent_as_reduced_tax_rate`等）
- 請求書作成は `/invoice_template_billings` エンドポイントを使用

## MoneyForward Expense API 仕様

### ベースURL
`https://expense.moneyforward.com/api/external/v1`

### 認証
- OAuth 2.0 Authorization Code Flow（請求書APIとは別キー）
- 認可/トークンのホストが請求書・会計と違う（`expense.moneyforward.com/oauth/...`）
- スコープ（`src/config.ts` が正）: `office_setting:write` `user_setting:write`
  `transaction:write` `report:write` `account:write` `public_resource:read`

### 主要エンドポイント（実装が叩いている形。`/me` の有無に注意）
| リソース | エンドポイント | メソッド |
|---------|---------------|---------|
| 事業者一覧 | `/offices` | GET |
| 経費明細 | `/offices/{id}/me/ex_transactions` | GET, POST |
| 経費明細詳細 | `/offices/{id}/me/ex_transactions/{id}` | GET, **PUT**, DELETE |
| 経費申請 | `/offices/{id}/me/ex_reports` | GET |
| 経費申請詳細 | `/offices/{id}/me/ex_reports/{id}` | GET |
| 申請の明細 | `/offices/{id}/ex_reports/{id}/ex_transactions` | GET（`/me` 無し。page/limit で全ページ取得する） |
| 申請承認 | `/offices/{id}/me/approving_ex_reports/{id}/approve` | POST |
| 申請却下 | `/offices/{id}/me/approving_ex_reports/{id}/disapprove` | POST |
| レシート | `/offices/{id}/me/upload_receipt` | POST (multipart) |
| 経費科目 | `/offices/{id}/ex_items` | GET |
| 部門 | `/offices/{id}/depts` | GET |
| プロジェクト | `/offices/{id}/projects` | GET |

## MoneyForward Accounting API v3 仕様

### ベースURL
`https://api-accounting.moneyforward.com`（パスは `/api/v3/...`）

### 認証
- OAuth 2.0 Authorization Code Flow（認可・トークンのエンドポイントは請求書と共通の
  `api.biz.moneyforward.com`。クライアントは会計用に別途登録する）
- スコープ: `mfc/accounting/journal.read` `journal.write` `accounts.read` `taxes.read`
  `departments.read` `offices.read` `trade_partners.read`

### 主要エンドポイント
| リソース | エンドポイント | メソッド |
|---------|---------------|---------|
| 仕訳 | `/api/v3/journals` | GET, POST |
| 仕訳詳細 | `/api/v3/journals/{id}` | GET, PUT, DELETE |
| 勘定科目 / 補助科目 | `/api/v3/accounts`, `/api/v3/sub_accounts` | GET |
| 税区分 / 部門 / 取引先 | `/api/v3/taxes`, `/api/v3/departments`, `/api/v3/trade_partners` | GET |
| 事業者 / 会計年度 | `/api/v3/offices`, `/api/v3/term_settings` | GET |

API 仕様書（yaml）は MoneyForward の開発者サイトから取得する。**リポジトリには同梱しない**
（MF の著作物であり再配布しない）。

### 会計 API / UI 運用上の注意
`docs/accounting-operational-notes.md` に、仕様書に書かれていない挙動をまとめてある。
特に重要なのは **API で POST した仕訳と銀行 feed の取引は自動リンクされず二重計上になる**点。
銀行口座の入出金が絡む仕訳は API で POST しない。

## レート制限
- 1秒あたり3リクエストまで（3 API 共有）
- `src/api/rate-limiter.ts` で自動制御

## 開発時の注意点

### ツール追加時
1. `src/types/` に型定義を追加（invoice系は `index.ts`、expense系は `expense.ts`）
2. `src/api/{service}/` にAPIモジュールを作成
3. `src/tools/{service}/` にMCPツールを作成
4. `src/index.ts` でツールをインポートして `allTools` に追加

### zodスキーマ
- 各ツールの `inputSchema` はzodで定義
- `zod-to-json-schema` でMCP向けJSON Schemaに変換

### テスト方法
1. `npm run build` でビルド
2. `npm run smoke` — stdio でハンドシェイク → `tools/list` を検証する。認証情報は不要。
   ツールを追加したら必要に応じて `scripts/smoke.mjs` の `REQUIRED_TOOLS` を更新する
3. 環境変数を設定してMCPクライアントから接続し、各ツールを手動で実行して確認


## 壊してはいけない不変条件（セキュリティレビュー由来）

公開前のレビューで修正した箇所。ここを緩めると同じ穴が開く。

1. **コールバックサーバはループバックだけに bind する**（`127.0.0.1` と `::1`）。
   host を省略すると `0.0.0.0` に bind され、LAN の他ホストから
   `/callback?error=...` を投げてフローを落とせる。
2. **コールバックは state を最初に検証する**。`error` や `code` を見る前。
   順序を入れ替えると、state を知らない第三者がフローを中断できる。
   比較は `crypto.timingSafeEqual`。
3. **URL に入る ID は必ず `pathParam()`**（`src/api/path.ts`）。
   `123/disapprove#` で承認が却下になる。
4. **破壊的な複数ステップは、最初の 1 件を壊す前に全体を検証する**。
   `replaceBillingItems` は `validateReplacementItems` を先に呼ぶ。
   検証前に削除を始めると、明細が全部消えた請求書が残る。
5. **catch した失敗は `isError: true` を付けて返す**。付けないと MCP 上は成功に見える。
6. **トークンファイルは 0600 / ディレクトリは 0700**。起動時に既存ファイルも締め直す。
7. **レシートアップロードは送信前にパスを検証する**（認証情報ディレクトリ・symlink・
   拡張子・サイズ）。任意パスを読んで送る口なので、ここが緩いとトークンを外部へ送れる。
8. **`tokenPromise` は必ず handle する**。未処理 rejection は Node プロセスを落とす。

`npm test` がこれらを守っている（`test/*.test.mjs`）。

## 既知の制限事項
- **納品書API**: v3 APIでは納品書関連のエンドポイントが提供されていません
- **経費APIレスポンス形状**: 型定義はゆるめに定義。実API呼び出しで検証後に厳格化予定
- **レシートアップロード**: Node 18+のネイティブFormDataを使用

### v3 API の独特な点（実検証済み）
- **PDF ダウンロード**: 一部のドキュメントが示唆する `/billings/{id}/pdf` は存在しない。Billing オブジェクトの `pdf_url` フィールド（拡張子形式 `.../billings/{id}.pdf`）を使用する。`download_*_pdf` 関数は GET billing → `pdf_url` を返す方式で実装。
- **明細の部分更新は不可**: `/billings/{id}/items/{item_id}` は `GET` と `DELETE` のみで、`PUT`/`PATCH` は提供されない。`BillingUpdateRequest` にも `items` 配列は含まれない。明細1件の数量等を変えたい場合は `DELETE /billings/{id}/items/{item_id}` → `POST /billings/{id}/items` で再作成する。
- **明細追加のリクエストボディは非ラップ**: `POST /billings/{id}/items` のボディは `{name, price, quantity, excise, ...}` をトップレベルに置く。`{"item": {...}}` でラップすると `Validation failed: Excise can't be blank` で 422 になる。
- **billing / quote 更新は PUT のみ + ボディは非ラップ**: 仕様上は `PUT /billings/{id}` / `PUT /quotes/{id}` のみ対応。`PATCH` は 404。リクエストボディは `BillingUpdateRequest`/`QuoteUpdateRequest` をトップレベルに置く（旧実装の `{billing: params}` ラップは API 側に黙って無視される — 200 が返るが何も更新されない）。`updateBilling` / `updateQuote` 修正済み（実検証: `PUT /billings/{id}` with `{memo: "..."}` → memo 反映）。
- **payment_status 更新は別エンドポイント**: `PUT /billings/{id}/payment_status`、ボディ `{payment_status: "0" | "1" | "2"}`（未設定/未入金/入金済み、**文字列**）。読み取りは日本語文字列（`未設定`/`未入金`/`入金済み`/`未払い`/`振込済み`）で返る非対称な設計。`updatePaymentStatus` は修正済みで、更新後に `getBilling` で再取得した結果を返す。
- **明細の全置換は atomic でない**: `mf_update_billing` の `items` は「既存明細を 1 件ずつ DELETE → 新明細を POST」に展開される。途中で失敗すると明細が欠けた状態で残るため、エラー本文に削除前のスナップショットを含めている。
- **摘要・メモでの検索が無い**: 仕訳も請求書も日付・勘定科目などでしか絞り込めない。memo に埋めた冪等性キーで重複検出するには、期間取得 + クライアント側フィルタになる。
