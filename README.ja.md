[English](./README.md) | [日本語](./README.ja.md)

# moneyforward-connector

マネーフォワード クラウド **請求書**・**経費**・**会計** を、公開 API 経由で AI アシスタントに操作させる MCP サーバーである。

## 概要

マネーフォワードには公式のリモート MCP サーバーがあるが、対象は **クラウド会計・確定申告のみ**である。クラウド請求書・クラウド経費・クラウド給与は対象外で、追加するというロードマップも公表されていない（2026-09-11 確認）。

本コネクタはその穴を埋める。ローカルで動く stdio 型の MCP サーバーであり、3 プロダクトにまたがる **56 ツール**を公開する。請求書の発行、レシート画像を添付した経費登録、仕訳の登録を、Web UI を人がクリックせずに行える。

想定利用者は、自分でバックオフィスを回している一人法人・フリーランスである。コードを書く必要はない。ただし**プロダクトごとに 1 回、マネーフォワード側で API クライアントを登録する**必要があり、それが下記セットアップの大半を占める。

## 会計は公式 MCP を使うこと

**会計だけが目的なら、本コネクタではなく公式 MCP サーバーを使うべきである。** クラウド会計を契約していれば追加料金なしで使え、OAuth クライアントの登録も不要で、本コネクタに無いレポートまで参照できる。

```bash
claude mcp add --transport http mf-ca https://beta.mcp.developers.biz.moneyforward.com/mcp/ca/v3
```

- 公式案内: https://biz.moneyforward.com/support/account/guide/others/ot10.html
- 開発者サイト: https://developers.biz.moneyforward.com/mcp/

| 機能 | 公式 MCP | 本コネクタ |
|---|:-:|:-:|
| クラウド会計 — 仕訳・マスタ | ✅ | ✅ |
| 残高試算表・推移表 | ✅ | ❌ |
| 入出金明細の参照、未仕訳明細からの仕訳作成 | ✅ | ❌ |
| **仕訳の削除** | ❌ | ✅（`confirm: true` 必須） |
| **dry-run プレビューと投入前の借貸一致検証** | ❌ | ✅ |
| **クラウド請求書** — 見積書・請求書・インボイス制度対応・PDF URL | ❌ | ✅ |
| **クラウド経費** — 経費明細・経費申請・**レシート画像のアップロード** | ❌ | ✅ |
| クラウド給与 | ❌ | ❌（明細 PDF のエンドポイントが存在しない） |

**両方を併用する形が想定構成である。**会計は公式、請求書と経費は本コネクタ。本コネクタの会計ツールは、OAuth 設定を 1 系統で済ませたい場合、および仕訳削除と dry-run が必要な場合のために残してある。

## クイックスタート

```bash
# 認証情報はコマンドに貼らず、入力する。シェル履歴に残らない。
# bash / zsh の両方で動く。
printf '請求書 client ID: ';     read -r  MF_INVOICE_CLIENT_ID
printf '請求書 client secret: '; read -rs MF_INVOICE_CLIENT_SECRET; echo

# 両方入力されたときだけ登録する。
# インストール作業は不要で、npx が初回実行時にパッケージを取得する。
if [ -n "$MF_INVOICE_CLIENT_ID" ] && [ -n "$MF_INVOICE_CLIENT_SECRET" ]; then
  claude mcp add moneyforward \
    --env MF_INVOICE_CLIENT_ID="$MF_INVOICE_CLIENT_ID" \
    --env MF_INVOICE_CLIENT_SECRET="$MF_INVOICE_CLIENT_SECRET" \
    --env MF_REDIRECT_URI=http://127.0.0.1:38080/callback \
    -- npx -y @knorq/moneyforward-connector
else
  echo '認証情報が未入力。登録していない。'
fi
```

あとは AI クライアントで `mf_auth_start` を実行し、表示された URL を開くだけである。

**先に認証情報を取る必要がある。** マネーフォワードは API クライアントを利用者ごと・プロダクトごとに発行する形を取っており、これが無いと何も動かない。そこが 10 分程度かかる部分で、1 回で済む。手順は下記セットアップを参照。

## セットアップ

### 1. マネーフォワードで API クライアントを登録する

**マネーフォワードの API はプロダクト別である。クラウド請求書・クラウド経費・クラウド会計は、それぞれ別のクライアント ID とシークレットを必要とする。**使うプロダクトの分だけ登録すればよい。

マネーフォワードの開発者向け設定（https://developers.biz.moneyforward.com/ ）を開き、プロダクトごとにアプリケーションを新規登録する。フォームには次を入れる。

| 項目 | 入れる値 |
|---|---|
| リダイレクト URI | `http://127.0.0.1:38080/callback` — ポート番号まで完全一致させる。`localhost` ではなく IP リテラルを使う（ネイティブアプリ向けに RFC 8252 が推奨する形で、`localhost` の名前解決に左右されない）。MF のフォームが `localhost` しか受け付けない場合はそれでも動く |
| クライアント認証方式 | **`client_secret_post`**（既定は `client_secret_basic` だが、本コネクタはこれを使わない） |
| スコープ | プロダクト別に下表のとおり |

必要なスコープ:

| プロダクト | スコープ |
|---|---|
| 請求書 | `mfc/invoice/data.read` `mfc/invoice/data.write` |
| 会計 | `mfc/accounting/journal.read` `mfc/accounting/journal.write` `mfc/accounting/accounts.read` `mfc/accounting/taxes.read` `mfc/accounting/departments.read` `mfc/accounting/offices.read` `mfc/accounting/trade_partners.read` |
| 経費 | `transaction:write` `report:write` `account:write` `office_setting:write` `user_setting:write` `public_resource:read` |

各アプリケーションのクライアント ID とシークレットを控える。開発者ポータルの画面文言は変わることがある。表と項目名が違う場合は意味で対応させ、公式の開発者ドキュメントを確認すること。

> クラウド経費の認可先は共通の `api.biz.moneyforward.com` ではなく `expense.moneyforward.com` であり、クライアントはクラウド経費自身の設定画面から登録する。フォームが見つからない場合は、マネーフォワードのサポートサイトでクラウド経費の外部 API を検索すること。

### 2. 認証情報を付けて MCP サーバーを登録する

```bash
# -s で secret を画面に出さない。どの値もシェル履歴に残らず、
# シェルを抜ければ変数も消える。プロンプトを printf にしているのは、
# **zsh では `read -p` が動かない**（coprocess 用のオプションのため）。
# 登録していないプロダクトは Enter で飛ばす。
printf '請求書 client ID: ';     read -r  MF_INVOICE_CLIENT_ID
printf '請求書 client secret: '; read -rs MF_INVOICE_CLIENT_SECRET; echo
printf '経費 client ID: ';       read -r  MF_EXPENSE_CLIENT_ID
printf '経費 client secret: ';   read -rs MF_EXPENSE_CLIENT_SECRET; echo
printf '会計 client ID: ';       read -r  MF_ACCOUNTING_CLIENT_ID
printf '会計 client secret: ';   read -rs MF_ACCOUNTING_CLIENT_SECRET; echo

# ID と secret が**両方**揃っているプロダクトの --env だけを積む。
# これにより経費のみ・会計のみの登録も正しく動く。
set --
if [ -n "$MF_INVOICE_CLIENT_ID" ] && [ -n "$MF_INVOICE_CLIENT_SECRET" ]; then
  set -- "$@" --env MF_INVOICE_CLIENT_ID="$MF_INVOICE_CLIENT_ID" \
              --env MF_INVOICE_CLIENT_SECRET="$MF_INVOICE_CLIENT_SECRET"
fi
if [ -n "$MF_EXPENSE_CLIENT_ID" ] && [ -n "$MF_EXPENSE_CLIENT_SECRET" ]; then
  set -- "$@" --env MF_EXPENSE_CLIENT_ID="$MF_EXPENSE_CLIENT_ID" \
              --env MF_EXPENSE_CLIENT_SECRET="$MF_EXPENSE_CLIENT_SECRET"
fi
if [ -n "$MF_ACCOUNTING_CLIENT_ID" ] && [ -n "$MF_ACCOUNTING_CLIENT_SECRET" ]; then
  set -- "$@" --env MF_ACCOUNTING_CLIENT_ID="$MF_ACCOUNTING_CLIENT_ID" \
              --env MF_ACCOUNTING_CLIENT_SECRET="$MF_ACCOUNTING_CLIENT_SECRET"
fi

if [ "$#" -gt 0 ]; then
  claude mcp add moneyforward "$@" \
    --env MF_REDIRECT_URI=http://127.0.0.1:38080/callback \
    -- npx -y @knorq/moneyforward-connector
else
  echo 'ID と secret の揃った組が 1 つも無い。登録していない。'
fi
```

登録されるのは ID と secret が揃っているプロダクトだけである。
片方しか無いプロダクトは、中途半端に設定せず飛ばす。

> **secret がどこに保存されるか。** `claude mcp add` は渡した値を Claude Code 自身の
> 設定ファイル（`~/.claude.json`）に**平文で**書き込む。他の MCP クライアントも同様に
> 自分の設定ファイルへ書く。つまりそのファイルは生の認証情報を持つことになる。
> `chmod 600 ~/.claude.json` で権限を絞り、repo には置かず、漏れたら MF 側で
> クライアントを再発行する。なお secret をコマンドラインに直接書くと**シェル履歴にも
> 残る**。上の `read -s` はそれを避けるためである。

毎回入力するよりファイルに置きたい場合は、**作成時点から所有者のみ**になるよう
umask を絞ってから、エディタで中身を書く（エディタで打てばシェル履歴にも残らない）:

```bash
umask 077
mkdir -p ~/.config/mf-mcp
${EDITOR:-nano} ~/.config/mf-mcp/credentials.env
```

```bash
# ~/.config/mf-mcp/credentials.env
MF_INVOICE_CLIENT_ID=...
MF_INVOICE_CLIENT_SECRET=...
```

`-rw-------` になっていることを確認し、登録コマンドの前に読み込む:

```bash
ls -l ~/.config/mf-mcp/credentials.env
set -a; . ~/.config/mf-mcp/credentials.env; set +a
```

設定ファイルで設定するクライアントの場合（Claude Desktop は `~/Library/Application Support/Claude/claude_desktop_config.json`）:

```json
{
  "mcpServers": {
    "moneyforward": {
      "command": "npx",
      "args": ["-y", "@knorq/moneyforward-connector"],
      "env": {
        "MF_INVOICE_CLIENT_ID": "xxxxxxxx",
        "MF_INVOICE_CLIENT_SECRET": "xxxxxxxx",
        "MF_EXPENSE_CLIENT_ID": "xxxxxxxx",
        "MF_EXPENSE_CLIENT_SECRET": "xxxxxxxx",
        "MF_REDIRECT_URI": "http://127.0.0.1:38080/callback"
      }
    }
  }
}
```

この設定ファイルは認証情報を平文で持つ。`chmod 600` し、絶対にコミットしない。

#### 別の方法: clone してビルドする

ソースから動かす場合（commit を固定したい、帳簿を任せる前にコードを読みたい、改造したい）:

```bash
git clone https://github.com/knorq-ai/moneyforward-connector.git
cd moneyforward-connector
npm install
npm run build
```

npx の代わりに、ビルドしたエントリポイントを指定する:

```bash
claude mcp add moneyforward \
  --env MF_INVOICE_CLIENT_ID="$MF_INVOICE_CLIENT_ID" \
  --env MF_INVOICE_CLIENT_SECRET="$MF_INVOICE_CLIENT_SECRET" \
  --env MF_REDIRECT_URI=http://127.0.0.1:38080/callback \
  -- node /absolute/path/to/moneyforward-connector/dist/index.js
```

### 3. プロダクトごとに 1 回認証する

AI クライアントで、登録したプロダクトの認証ツールを実行する。

| プロダクト | ツール |
|---|---|
| 請求書 | `mf_auth_start` |
| 経費 | `mf_expense_auth_start` |
| 会計 | `mf_accounting_auth_start` |

いずれも URL を返す。ブラウザで開き、マネーフォワードにログインして認可する。その後の挙動は `MF_REDIRECT_URI` で決まる。

- **`http://127.0.0.1:38080/callback` を設定した場合** — コネクタがループバックにコールバックサーバーを立て、認証コードを自動で受け取ってトークンを保存する。ポート 38080 が空いていること、認可を 5 分以内に終えることが条件である。
- **未設定の場合** — OOB モードになる。マネーフォワードが画面にコードを表示するので、それを `mf_auth_callback`（経費は `mf_expense_auth_callback`、会計は `mf_accounting_auth_callback`）に渡す。

以降はトークンが再利用され、自動でリフレッシュされる。状態はいつでも `mf_auth_status` / `mf_expense_auth_status` / `mf_accounting_auth_status` で確認できる。

## 設定

| 変数 | プロダクト | 必須 | 備考 |
|---|---|:-:|---|
| `MF_INVOICE_CLIENT_ID` | 請求書 | 請求書ツールを使うなら | `MF_CLIENT_ID` でも可 |
| `MF_INVOICE_CLIENT_SECRET` | 請求書 | 請求書ツールを使うなら | `MF_CLIENT_SECRET` でも可 |
| `MF_EXPENSE_CLIENT_ID` | 経費 | 経費ツールを使うなら | |
| `MF_EXPENSE_CLIENT_SECRET` | 経費 | 経費ツールを使うなら | |
| `MF_ACCOUNTING_CLIENT_ID` | 会計 | 会計ツールを使うなら | |
| `MF_ACCOUNTING_CLIENT_SECRET` | 会計 | 会計ツールを使うなら | |
| `MF_REDIRECT_URI` | 共通 | 任意 | `http://127.0.0.1:38080/callback` を設定すると自動フロー。未設定なら OOB モード。ループバック以外のホストは拒否し、ポートは `MF_CALLBACK_PORT` と一致していなければエラーにする |
| `MF_CALLBACK_PORT` | 共通 | 任意 | 既定 `38080`。登録したリダイレクト URI のポートと一致させる |

使わないプロダクトの認証情報は省略してよい。そのプロダクトのツールは、不足している変数名を示すエラーを返すだけである。

## ツール

**[ツール一覧の全文 → `docs/tools.md`](./docs/tools.md)** — 全 56 ツール、読み取り / 書き込みの別つき。

| プロダクト | ツール数 | 対象範囲 |
|---|:-:|---|
| 請求書 | 23 | 取引先・品目・見積書・請求書（インボイス制度対応）・入金ステータス・PDF URL |
| 経費 | 17 | 事業者・経費科目・部門・プロジェクト・経費明細・レシートアップロード・経費申請 |
| 会計 | 16 | 仕訳（作成 / 更新 / 削除、dry-run つき）・勘定科目・補助科目・税区分・部門・取引先・会計年度 |

ツールの description は日本語である。利用者が突き合わせるマネーフォワードの UI の言語に合わせてある。

## 仕組み

- 1 つの stdio MCP サーバープロセスが 3 プロダクト全ツールを公開する。起動するのは AI クライアントであり、常駐 daemon は無く、OAuth コールバック中を除いてネットワークを listen しない。
- プロダクトごとに独立した `OAuthManager` を初回利用時に遅延生成し、トークンファイルも別々に持つ。請求書の認証は経費に影響しない。
- トークンは「有効期限の 5 分前を過ぎた状態で次に API を呼んだとき」に、保存済み refresh token で自動更新する。バックグラウンドのタイマーは持たない。
- レート制限は 3 プロダクト共有で 1 秒あたり 3 リクエスト。HTTP 429 は `Retry-After`（秒数形式・HTTP-date 形式の両方、上限 60 秒）に従って最大 3 回までリトライする。JSON リクエストとレシートアップロードの両方が対象。上限を超えたら無限リトライせずエラーにする。
- 全ツールの入力は API 呼び出し前に zod スキーマで検証し、MCP のツール一覧用に JSON Schema へ変換している。

## セキュリティ

- **トークンはディスクに保存される。** 保存先は `~/.config/mf-mcp/{invoice,expense,accounting}-tokens.json`、パーミッションは `0600`、ディレクトリは `0700`。旧バージョンが残した緩いパーミッションは起動時に締め直す。暗号化はしていないため、同一ユーザーでホームディレクトリを読める者は読める。
- **失効には 2 段階必要。** トークンファイルを消すだけでは足りない。起動中のコネクタはトークンをメモリに保持しており、次のリフレッシュで書き戻す。さらに旧パス `~/.config/mf-invoice-mcp/tokens.json` が残っていれば再起動時に移行で復活する。確実に切るには、**このサーバーを起動しているクライアントを全て停止** → 現行パスと旧パスのトークンファイルを削除 → **MF 側でアプリケーションの認可を取り消す**。既に発行済みのトークンを無効化できるのは最後の手順だけである。
- **クライアントシークレットは環境変数からのみ読む。** ハードコードは一切無い。MCP の設定ファイルに書く場合、そのファイルは生の認証情報を持つことになる。コミットしてはならない。クライアントが対応しているなら OS のキーチェーンや shell の export を優先する。
- **トークンと `Authorization` ヘッダは、ログ・エラーメッセージ・ツール結果のいずれにも出さない。** 認証ツールが返すのは認証済みか否かと有効期限だけである。
- **OAuth コールバックサーバーはループバック（`127.0.0.1` と、利用可能なら `::1`）だけに bind する**ので、ネットワーク経由では到達できない。認可が進行中の間（5 分でタイムアウト）しか起動しない。`state` はフローごとに生成し、**リクエストの他の要素を見る前に**定数時間で比較する。したがって正しい state を持たないリクエストは、進行中の認可に影響も中断もできない。
- **パスパラメータを検証する。** API の URL に埋め込む ID は英数字・ハイフン・アンダースコアのみを許可する。細工した ID で別エンドポイント（例: 承認の呼び出しを却下に飛ばす）へリクエストを向けられない。
- **レシートアップロードは認証情報を送らない。** トークンキャッシュ等の認証情報ディレクトリに解決されるパス（symlink 経由も）、画像 / PDF 以外の拡張子、ディレクトリ、サイズ超過は、**送信前に**すべて拒否する。
- **書き込みツールはデータを壊し得る。** `mf_delete_billing` と `mf_accounting_delete_journal` は不可逆であり、`mf_update_billing` の `items` は途中失敗で明細が欠ける。このサーバーのツール呼び出しを一括許可してはならない。帳簿への書き込みは 1 件ずつ内容を見て許可すること。

## 既知の制約

- **クラウド給与は非対応。** 給与 API v2 に明細 PDF を取得するエンドポイントが無いため、ラップする対象が存在しない。
- **納品書は作成できない。** 請求書 API v3 に納品書エンドポイントが無い。`mf_create_delivery_slip` は登録されているが失敗する。Web UI を使うこと。
- **請求書の税込表示は API で指定できない。** 請求書・見積書の作成 / 更新の契約に該当フィールドが無いため、税込 / 税抜のどちらで表示するかは Web UI 側で設定する。
- **請求書の明細は 1 件ずつ更新できない。** `PUT /billings/{id}` は `items` を無視する。`mf_update_billing` は全明細を削除して再投入する形で回避しているが、atomic ではない。
- **請求書の取引先は変更できない。** 更新の API 契約に `partner_id` が無い。作り直すこと。
- **取引先に部署が複数あるときは `department_id` が必要。** 先頭を黙って選ばず、`mf_create_billing` / `mf_create_quote` が一覧を返して選択を促す。
- **摘要・メモでの検索が無い。** 仕訳も請求書も日付・勘定科目などでしか絞り込めない。memo に埋めた冪等性キーで重複を検出するには、期間で取得してクライアント側でフィルタする。
- **会計の取引先は参照のみ。** 作成ツールは無い。新規取引先は Web UI で登録する。
- **金額は数値文字列で返る**（例: `"123456.0"`）。入金ステータスは非対称で、読み取りは日本語文字列、書き込みは `"0"` / `"1"` / `"2"` である。
- **経費 API のレスポンス型はゆるく定義してある。** 実レスポンスに当たった分から検証して絞っている。

## 開発

```bash
npm install
npm run build
npm test         # ユニットテスト。認証情報は不要
npm run smoke    # stdio ハンドシェイクと tools/list。認証情報は不要
```

`npm test` は、パスパラメータ検証・OAuth コールバックの state 優先検証とループバック bind・請求書明細のガード・レシートパスのガード・設定値の検証を対象とする。`npm run smoke` はビルド済みサーバーを起動して MCP ハンドシェイクを行い、全ツールが name / description / schema を持って列挙されることを確認する（**存在の確認であり、各スキーマが意味的に正しいことの検証ではない**）。ツールの追加方法は `CONTRIBUTING.md` を参照。

## 動作要件

- Node.js 20 以上
- 使用するプロダクトごとのマネーフォワード クラウド契約（API 利用可能なもの）

## ライセンス

MIT。本プロジェクトは [tera911/mf-invoice-mcp](https://github.com/tera911/mf-invoice-mcp)（MIT）を fork し、経費モジュールと会計モジュールを追加したものである。保持している著作権表示は `LICENSE` を参照。
