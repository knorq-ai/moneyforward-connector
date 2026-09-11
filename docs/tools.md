# Tool reference / ツール一覧

[English](../README.md) | [日本語](../README.ja.md)

All 56 tools exposed by `@knorq-ai/moneyforward-connector`, grouped by MoneyForward product. Tool descriptions are in Japanese because that is what the MCP client sees.

`R/W` marks whether a tool only reads (`R`) or changes data (`W`). ⚠️ marks irreversible or partially-destructive operations — always review these before allowing them.

本コネクタが公開する全 56 ツール。プロダクト別に整理してある。`R/W` の `W` はデータを変更するツール、⚠️ は不可逆または部分的に破壊的な操作である。

## Invoice / クラウド請求書 — 23 tools

Credentials: `MF_INVOICE_CLIENT_ID` + `MF_INVOICE_CLIENT_SECRET`

### Auth

| Tool | R/W | Description |
|---|:-:|---|
| `mf_auth_status` | R | 認証状態を確認します |
| `mf_auth_start` | W | OAuth認証を開始します。デフォルトはOOBモード（認証コードが画面に表示される）。MF_REDIRECT_URIにlocalhost URLを設定するとコールバックサーバーモードになります。 |
| `mf_auth_callback` | W | 認証コードを使用してアクセストークンを取得します（OOBモードで認証後に使用） |
| `mf_refresh_token` | W | アクセストークンをリフレッシュします |

### Partners & items / 取引先・品目

| Tool | R/W | Description |
|---|:-:|---|
| `mf_list_partners` | R | 取引先一覧を取得します。検索キーワードで絞り込み可能です。 |
| `mf_get_partner` | R | 取引先の詳細情報を取得します |
| `mf_list_items` | R | 品目一覧を取得します。検索キーワードで絞り込み可能です。 |
| `mf_get_item` | R | 品目の詳細情報を取得します |

### Quotes / 見積書

| Tool | R/W | Description |
|---|:-:|---|
| `mf_list_quotes` | R | 見積書一覧を取得します。取引先や期間で絞り込み可能です。 |
| `mf_get_quote` | R | 見積書の詳細情報を取得します |
| `mf_create_quote` | W | インボイス制度対応の見積書を作成します |
| `mf_update_quote` | W | 見積書を更新します |
| `mf_download_quote_pdf` | R | 見積書のPDF URLを取得します |
| `mf_convert_quote_to_billing` | W | 見積書を請求書に変換します |

### Billings / 請求書

| Tool | R/W | Description |
|---|:-:|---|
| `mf_list_billings` | R | 請求書一覧を取得します。取引先や期間で絞り込み可能です。 |
| `mf_get_billing` | R | 請求書の詳細情報を取得します |
| `mf_create_billing` | W | インボイス制度対応の請求書を作成します |
| `mf_create_billing_from_quote` | W | 見積書から請求書を作成します |
| `mf_update_billing` | W ⚠️ | 請求書を更新します。items を指定すると明細を全置換します（既存明細を削除してから追加するため、途中で失敗すると明細が欠けた状態になり得ます）。取引先の変更は API 非対応です。 |
| `mf_delete_billing` | W ⚠️ | 請求書を削除します。元に戻せないため、実行前に必ずユーザーへ確認してください。 |
| `mf_update_payment_status` | W | 請求書の入金状態を更新します |
| `mf_download_billing_pdf` | R | 請求書のPDF URLを取得します |

### Delivery slips / 納品書

| Tool | R/W | Description |
|---|:-:|---|
| `mf_create_delivery_slip` | W | 【v3 API未サポート】見積書から納品書を作成します。※現在v3 APIでは納品書作成エンドポイントが提供されていないため、このツールは機能しません。納品書はマネーフォワードのWebUIから作成してください。 |

## Expense / クラウド経費 — 17 tools

Credentials: `MF_EXPENSE_CLIENT_ID` + `MF_EXPENSE_CLIENT_SECRET`

### Auth

| Tool | R/W | Description |
|---|:-:|---|
| `mf_expense_auth_start` | W | 経費API OAuth認証を開始します。デフォルトはOOBモード（認証コードが画面に表示される）。 |
| `mf_expense_auth_status` | R | 経費API認証状態を確認します |
| `mf_expense_auth_callback` | W | 経費API認証コードを使用してアクセストークンを取得します（OOBモードで認証後に使用） |

### Masters / マスタ

| Tool | R/W | Description |
|---|:-:|---|
| `mf_expense_list_offices` | R | 事業者一覧を取得します |
| `mf_expense_list_ex_items` | R | 経費科目一覧を取得します |
| `mf_expense_list_depts` | R | 部門一覧を取得します |
| `mf_expense_list_projects` | R | プロジェクト一覧を取得します |

### Transactions / 経費明細

| Tool | R/W | Description |
|---|:-:|---|
| `mf_expense_list_transactions` | R | 自分の経費明細一覧を取得します |
| `mf_expense_get_transaction` | R | 経費明細の詳細を取得します |
| `mf_expense_create_transaction` | W | 経費明細を作成します |
| `mf_expense_update_transaction` | W | 経費明細を更新します |
| `mf_expense_delete_transaction` | W ⚠️ | 経費明細を削除します。**元に戻せません**（コネクタに undo はありません）。実行前に対象の明細 ID・日付・金額・摘要をユーザーへ提示して確認を取ってください。 |
| `mf_expense_upload_receipt` | W ⚠️ | レシート画像・PDF をアップロードします。**アップロードだけで経費明細が新規作成される場合があります**（MF 側が OCR して明細を起票する）。添付のみを意図していて別途 mf_expense_create_transaction でも明細を作ると二重計上になるため、結果の「作成された明細数」を必ず確認してください。許可拡張子: jpg / jpeg / png / gif / heic / heif / pdf。認証情報ディレクトリ配下のファイルは拒否します。 |

### Reports / 経費申請

| Tool | R/W | Description |
|---|:-:|---|
| `mf_expense_list_reports` | R | 自分の経費申請一覧を取得します |
| `mf_expense_get_report` | R | 経費申請の詳細と明細を取得します |
| `mf_expense_approve_report` | W | 経費申請を承認します |
| `mf_expense_disapprove_report` | W | 経費申請を却下します |

## Accounting / クラウド会計 — 16 tools

Credentials: `MF_ACCOUNTING_CLIENT_ID` + `MF_ACCOUNTING_CLIENT_SECRET`

### Auth

| Tool | R/W | Description |
|---|:-:|---|
| `mf_accounting_auth_start` | W | 会計API OAuth認証を開始する。デフォルトはOOBモード（認証コードが画面に表示される）。 |
| `mf_accounting_auth_status` | R | 会計API認証状態を確認する |
| `mf_accounting_auth_callback` | W | 会計API認証コードを使用してアクセストークンを取得する（OOBモードで認証後に使用） |
| `mf_accounting_refresh_token` | W | 会計API アクセストークンをリフレッシュする |

### Journals / 仕訳

| Tool | R/W | Description |
|---|:-:|---|
| `mf_accounting_list_journals` | R | 会計仕訳一覧を取得する。start_date または end_date のいずれかを指定する必要がある（同一会計期間内）。 |
| `mf_accounting_get_journal` | R | 会計仕訳の詳細を取得する |
| `mf_accounting_create_journal` | W | 会計仕訳を新規作成する（POST /api/v3/journals）。dry_run=true の場合は API を呼ばず、組み立てたリクエストボディを JSON で返す。冪等性キー（memo の決定的キー、tags=mf-mcp:auto 等）は呼び出し側で組み立てて memo / tags に渡すこと。事前に各 branch の借貸合計が一致することを検証する。 |
| `mf_accounting_update_journal` | W | 既存の会計仕訳を更新する（PUT /api/v3/journals/{id}）。dry_run=true の場合は API を呼ばず、組み立てたリクエストボディを JSON で返す。事前に各 branch の借貸合計が一致することを検証する。 |
| `mf_accounting_delete_journal` | W ⚠️ | 会計仕訳を削除する（DELETE /api/v3/journals/{id}）。不可逆操作。誤削除防止のため confirm=true を必ず指定する。 |

### Masters / マスタ

| Tool | R/W | Description |
|---|:-:|---|
| `mf_accounting_list_accounts` | R | 勘定科目一覧を取得する |
| `mf_accounting_list_sub_accounts` | R | 補助科目一覧を取得する |
| `mf_accounting_list_taxes` | R | 税区分一覧を取得する |
| `mf_accounting_list_departments` | R | 部門一覧を取得する |
| `mf_accounting_list_trade_partners` | R | 取引先一覧を取得する（会計） |
| `mf_accounting_get_office` | R | 現在の事業者情報と会計期間を取得する |
| `mf_accounting_list_term_settings` | R | 会計年度設定一覧を取得する |

## Notes

- `mf_create_delivery_slip` is registered but **cannot work**: MoneyForward Invoice API v3 exposes no delivery-slip endpoint. Create delivery slips in the web UI.
- `mf_update_billing` with `items` replaces every line item by deleting then re-posting each one. The whole replacement is validated before the first delete, so an invalid payload changes nothing. A failure part-way through the delete or the re-post leaves the billing with missing line items; in both cases the error carries a snapshot of the pre-delete state.
- `mf_expense_upload_receipt` can create expense entries on its own (MoneyForward reads the receipt). Check the reported count before also calling `mf_expense_create_transaction`, or the expense is recorded twice.
- `mf_accounting_delete_journal` requires `confirm: true`. `mf_accounting_create_journal` / `mf_accounting_update_journal` accept `dry_run: true` to return the request body without calling the API. `mf_accounting_update_journal` preserves the stored `journal_type` when you omit it, so updating one field cannot turn an adjusting entry into an ordinary one.
- `mf_create_billing` / `mf_create_quote` require `department_id` when the partner has more than one department, instead of silently using the first.
- Every id that goes into an API path is validated (alphanumerics, hyphens, underscores only) so a crafted id cannot redirect a call to a different endpoint. A tool that fails returns `isError: true`.
- Rate limiting is shared across all three products: 3 requests/second. HTTP 429 is retried up to 3 times (honouring `Retry-After` in seconds or HTTP-date form, capped at 60s) for JSON requests and receipt uploads alike, then fails.

- `mf_create_delivery_slip` は登録されているが**動作しない**。v3 API に納品書エンドポイントが無いため、納品書は Web UI で作成する。
- `mf_update_billing` の `items` は明細を全置換する。**削除を 1 件も行う前に置換内容を全件検証する**ので、不正な内容なら請求書は無傷。削除ループ・再投入ループのどちらで失敗しても明細は欠けた状態で残るが、どちらの場合もエラー本文に削除前のスナップショットが入る。
- `mf_expense_upload_receipt` はアップロードだけで経費明細が作られることがある（MF 側がレシートを読む）。結果の件数を確認してから `mf_expense_create_transaction` を使う。しないと二重計上になる。
- `mf_accounting_delete_journal` は `confirm: true` 必須。`mf_accounting_create_journal` / `mf_accounting_update_journal` は `dry_run: true` で API を呼ばずリクエストボディだけ返す。`mf_accounting_update_journal` は `journal_type` 省略時に既存の区分を引き継ぐので、1 項目の更新で期末調整仕訳が通常仕訳に戻ることはない。
- `mf_create_billing` / `mf_create_quote` は、取引先に部署が複数あるとき `department_id` を要求する（先頭を黙って採用しない）。
- URL に入る ID は英数字・ハイフン・アンダースコアのみに検証されるため、細工した ID で別エンドポイントへリクエストを向けられない。失敗したツールは `isError: true` を返す。
- レート制限は 3 プロダクト共有で 1 秒あたり 3 リクエスト。HTTP 429 は `Retry-After`（秒数・HTTP-date の両形式、上限 60 秒）に従って最大 3 回リトライし、それを超えたらエラーにする。JSON リクエストとレシートアップロードの両方が対象。
