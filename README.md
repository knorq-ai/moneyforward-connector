[English](./README.md) | [日本語](./README.ja.md)

# moneyforward-connector

An MCP server that lets an AI assistant operate MoneyForward Cloud **Invoice**, **Expense**, and **Accounting** through their public APIs.

## Overview

MoneyForward ships an official remote MCP server, but it covers **Cloud Accounting / Tax Return only**. Cloud Invoice, Cloud Expense, and Cloud Payroll are not part of it, and no roadmap for adding them has been published (checked 2026-09-11).

This connector fills that gap. It is a local stdio MCP server that exposes **56 tools** across three products, so an assistant can issue invoices, file expenses with receipt images attached, and post journal entries without anyone clicking through the web UI.

It is aimed at one-person companies and freelancers who run their own back office. You do not need to write code to use it — but you do need to register an API client in MoneyForward once per product, which is the bulk of the setup below.

## Use the official MCP server for accounting

**If you only need accounting, use MoneyForward's official MCP server, not this one.** It is free with a Cloud Accounting subscription, needs no OAuth client registration, and offers reports this connector does not.

```bash
claude mcp add --transport http mf-ca https://beta.mcp.developers.biz.moneyforward.com/mcp/ca/v3
```

- Official guide: https://biz.moneyforward.com/support/account/guide/others/ot10.html
- Developer site: https://developers.biz.moneyforward.com/mcp/

| Capability | Official MCP | This connector |
|---|:-:|:-:|
| Cloud Accounting — journals, masters | ✅ | ✅ |
| Trial balance / transition reports | ✅ | ❌ |
| Bank transaction lines, journals from unreconciled lines | ✅ | ❌ |
| **Journal deletion** | ❌ | ✅ (`confirm: true` required) |
| **Dry-run preview + debit/credit balance check before posting** | ❌ | ✅ |
| **Cloud Invoice** — quotes, billings, invoice-system compliance, PDF URLs | ❌ | ✅ |
| **Cloud Expense** — expense lines, reports, **receipt image upload** | ❌ | ✅ |
| Cloud Payroll | ❌ | ❌ (no payslip PDF endpoint exists) |

Running both side by side is the intended setup: the official server for accounting, this connector for invoice and expense. The accounting tools here are kept for people who want a single OAuth setup, or who need journal deletion and dry-run previews.

## Quick Start

```bash
# Type the credentials in rather than pasting them into the command, so
# they stay out of your shell history. Works in bash and zsh.
printf 'Invoice client ID: ';     read -r  MF_INVOICE_CLIENT_ID
printf 'Invoice client secret: '; read -rs MF_INVOICE_CLIENT_SECRET; echo

# Registers the connector only if both values were entered.
# There is no install step — npx fetches the package on first run.
if [ -n "$MF_INVOICE_CLIENT_ID" ] && [ -n "$MF_INVOICE_CLIENT_SECRET" ]; then
  claude mcp add moneyforward \
    --env MF_INVOICE_CLIENT_ID="$MF_INVOICE_CLIENT_ID" \
    --env MF_INVOICE_CLIENT_SECRET="$MF_INVOICE_CLIENT_SECRET" \
    --env MF_REDIRECT_URI=http://127.0.0.1:38080/callback \
    -- npx -y @knorq/moneyforward-connector
else
  echo 'No credentials entered — nothing was registered.'
fi
```

Then run `mf_auth_start` in your AI client and follow the URL it prints.

**Get the credentials first.** MoneyForward issues an API client per user, per product, and nothing works without one. That is the ten-minute part, and it is done once — see Setup below.

## Setup

### 1. Register an API client in MoneyForward

**MoneyForward's APIs are per product. Cloud Invoice, Cloud Expense, and Cloud Accounting each need their own client ID and secret.** Register only the products you intend to use.

Open MoneyForward's developer settings (https://developers.biz.moneyforward.com/) and create an application for each product. In the form:

| Field | What to enter |
|---|---|
| Redirect URI | `http://127.0.0.1:38080/callback` — must match exactly, including the port. Use the IP literal rather than `localhost`: it is what RFC 8252 recommends for native apps, and it cannot be affected by how your machine resolves `localhost`. (`localhost` is accepted too if MoneyForward's form insists on it.) |
| Client authentication method | **`client_secret_post`** (the default is `client_secret_basic`, which this connector does not use) |
| Scopes | see the table below, per product |

Required scopes:

| Product | Scopes |
|---|---|
| Invoice | `mfc/invoice/data.read` `mfc/invoice/data.write` |
| Accounting | `mfc/accounting/journal.read` `mfc/accounting/journal.write` `mfc/accounting/accounts.read` `mfc/accounting/taxes.read` `mfc/accounting/departments.read` `mfc/accounting/offices.read` `mfc/accounting/trade_partners.read` |
| Expense | `transaction:write` `report:write` `account:write` `office_setting:write` `user_setting:write` `public_resource:read` |

Copy the client ID and secret from each application. Screen labels in the developer portal change from time to time; if a field name differs from the table, match it by meaning and check the official developer documentation.

> Cloud Expense authorizes against `expense.moneyforward.com` rather than the shared `api.biz.moneyforward.com` endpoint, so its client is registered from within Cloud Expense's own settings. If you cannot find the form, search MoneyForward's support site for the Cloud Expense external API.

### 2. Register the MCP server with your credentials

```bash
# -s keeps each secret off the screen. Nothing reaches your shell history,
# and the variables disappear when the shell exits. bash and zsh both work;
# note `read -p` does NOT work in zsh, which is why the prompt is a printf.
# Press Enter to skip a product you did not register.
printf 'Invoice client ID: ';        read -r  MF_INVOICE_CLIENT_ID
printf 'Invoice client secret: ';    read -rs MF_INVOICE_CLIENT_SECRET; echo
printf 'Expense client ID: ';        read -r  MF_EXPENSE_CLIENT_ID
printf 'Expense client secret: ';    read -rs MF_EXPENSE_CLIENT_SECRET; echo
printf 'Accounting client ID: ';     read -r  MF_ACCOUNTING_CLIENT_ID
printf 'Accounting client secret: '; read -rs MF_ACCOUNTING_CLIENT_SECRET; echo

# Collect the --env arguments for each product whose ID and secret are BOTH
# set, so registering expense only — or accounting only — works too.
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
  echo 'No complete ID + secret pair was entered — nothing was registered.'
fi
```

A product is registered only when both halves of its pair are present; an ID
without its secret is skipped rather than half-configured.

> **Where the secrets end up.** `claude mcp add` writes these values in plain
> text into Claude Code's own configuration (`~/.claude.json`), and other MCP
> clients do the same in their config file. That file now holds live
> credentials: restrict it with `chmod 600 ~/.claude.json`, keep it out of any
> repository, and re-issue the client in MoneyForward if it leaks. Typing the
> secret as a literal on the command line instead would also record it in your
> shell history — that is what the `read -s` prompts above avoid.

If you would rather keep the credentials in a file than retype them, create
it with a restrictive umask so it is owner-only from the moment it exists, and
fill it in with an editor — typing the values into an editor keeps them out of
your shell history:

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

Confirm it came out `-rw-------`, then load it before the registration command:

```bash
ls -l ~/.config/mf-mcp/credentials.env
set -a; . ~/.config/mf-mcp/credentials.env; set +a
```

Or, for clients configured by file (Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json`):

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

That file holds live credentials in plain text. `chmod 600` it, and never commit it.

#### Alternative: clone and build

To run from source — to pin a commit, read the code before trusting it with your books, or modify it:

```bash
git clone https://github.com/knorq-ai/moneyforward-connector.git
cd moneyforward-connector
npm install
npm run build
```

Then point your client at the built entry point instead of npx:

```bash
claude mcp add moneyforward \
  --env MF_INVOICE_CLIENT_ID="$MF_INVOICE_CLIENT_ID" \
  --env MF_INVOICE_CLIENT_SECRET="$MF_INVOICE_CLIENT_SECRET" \
  --env MF_REDIRECT_URI=http://127.0.0.1:38080/callback \
  -- node /absolute/path/to/moneyforward-connector/dist/index.js
```

### 3. Authenticate once per product

In your AI client, run the auth tool for each product you registered:

| Product | Tool |
|---|---|
| Invoice | `mf_auth_start` |
| Expense | `mf_expense_auth_start` |
| Accounting | `mf_accounting_auth_start` |

Each prints a URL. Open it, sign in to MoneyForward, and approve. What happens next depends on `MF_REDIRECT_URI`:

- **Set to `http://127.0.0.1:38080/callback`** — the connector runs a loopback callback server, receives the code automatically, and saves the tokens. Port 38080 must be free, and the authorization must complete within 5 minutes.
- **Not set** — the connector falls back to out-of-band mode: MoneyForward shows you a code, and you pass it to `mf_auth_callback` (or `mf_expense_auth_callback` / `mf_accounting_auth_callback`).

Tokens are then reused and refreshed automatically. Check state any time with `mf_auth_status`, `mf_expense_auth_status`, `mf_accounting_auth_status`.

## Configuration

| Variable | Product | Required | Notes |
|---|---|:-:|---|
| `MF_INVOICE_CLIENT_ID` | Invoice | for invoice tools | `MF_CLIENT_ID` also accepted |
| `MF_INVOICE_CLIENT_SECRET` | Invoice | for invoice tools | `MF_CLIENT_SECRET` also accepted |
| `MF_EXPENSE_CLIENT_ID` | Expense | for expense tools | |
| `MF_EXPENSE_CLIENT_SECRET` | Expense | for expense tools | |
| `MF_ACCOUNTING_CLIENT_ID` | Accounting | for accounting tools | |
| `MF_ACCOUNTING_CLIENT_SECRET` | Accounting | for accounting tools | |
| `MF_REDIRECT_URI` | all | no | Set to `http://127.0.0.1:38080/callback` for the automatic flow. Unset means out-of-band mode. Only loopback hosts are accepted, and the port must match `MF_CALLBACK_PORT`. |
| `MF_CALLBACK_PORT` | all | no | Default `38080`. Must match the port in the redirect URI you registered. |

Credentials for a product you do not use can be omitted; its tools will simply return an error naming the missing variables.

## Tools

**[Full tool reference → `docs/tools.md`](./docs/tools.md)** — all 56 tools with read/write markers.

| Product | Tools | Covers |
|---|:-:|---|
| Invoice | 23 | Partners, items, quotes, billings (invoice-system compliant), payment status, PDF URLs |
| Expense | 17 | Offices, expense items, departments, projects, expense lines, receipt upload, expense reports |
| Accounting | 16 | Journals (create / update / delete, with dry-run), accounts, sub-accounts, taxes, departments, trade partners, fiscal years |

Tool descriptions are written in Japanese, matching the language of the MoneyForward UI that users cross-check against.

## How it works

- A single stdio MCP server process exposes all three products' tools. Your AI client starts it; there is no daemon and no network listener except during an OAuth callback.
- Each product gets its own `OAuthManager`, created lazily on first use, with its own token file. Authenticating for invoice does not touch expense.
- Tokens are refreshed on the next API call once they are within 5 minutes of expiry, using the stored refresh token. There is no background timer.
- All three products share one rate limiter: 3 requests/second. HTTP 429 is retried up to 3 times, honouring `Retry-After` in both seconds and HTTP-date form (capped at 60s), for JSON requests and receipt uploads alike. After that the call fails rather than retrying forever.
- Every tool input is validated with a zod schema before any API call, and converted to JSON Schema for the MCP tool listing.

## Security

- **Tokens are stored on disk** at `~/.config/mf-mcp/{invoice,expense,accounting}-tokens.json`, mode `0600` in a `0700` directory. Permissions on files and directories left behind by an older version are tightened on startup. They are not encrypted — anyone who can read your home directory as your user can read them.
- **Revoking takes two steps.** Deleting the token files is not enough: a running connector keeps the tokens in memory and will write them back on the next refresh, and an old `~/.config/mf-invoice-mcp/tokens.json` can be migrated back in on restart. To cut access off: stop every client that runs this server, delete both the current and the legacy token files, and then revoke the application's authorization in MoneyForward — only that last step invalidates tokens already issued.
- **Client secrets come from environment variables only.** Nothing is hardcoded. If you keep them in an MCP config file, that file holds live credentials — do not commit it, and prefer your OS keychain or a shell export where your client supports it.
- **Tokens and `Authorization` headers are never written to logs, error messages, or tool results.** Auth tools report only `authenticated` and an expiry timestamp.
- **The OAuth callback server binds only to the loopback interfaces** (`127.0.0.1`, and `::1` where available), so it is never reachable from your network. It runs only while an authorization is in flight (5-minute timeout). The `state` parameter is generated per flow and compared in constant time **before** anything else in the request is examined, so a request that does not carry the right state cannot affect or cancel a pending authorization.
- **Path parameters are validated.** Every id interpolated into an API URL must be plain alphanumerics, hyphens or underscores, so a crafted id cannot redirect a call to a different endpoint (for example making an approval land on the disapproval route).
- **Receipt upload will not transmit your credentials.** Paths resolving into the token cache or other credential directories are refused, as are symlinks to them, non-image/PDF extensions, directories, and oversized files — all before anything is sent.
- **Write tools can destroy data.** `mf_delete_billing` and `mf_accounting_delete_journal` are irreversible, and `mf_update_billing` with `items` can leave line items missing if it fails part-way. Do not blanket-approve tool calls for this server; review writes to your books individually.

## Known limitations

- **Cloud Payroll is not supported.** The Payroll API v2 has no endpoint for payslip PDFs, so there is nothing to wrap.
- **Delivery slips cannot be created.** Invoice API v3 exposes no delivery-slip endpoint; `mf_create_delivery_slip` is registered but fails. Use the web UI.
- **Tax-inclusive display cannot be set via the API.** The billing and quote create/update contracts have no field for it, so whether a document presents tax-inclusive or tax-exclusive amounts has to be set in the web UI.
- **Billing line items cannot be patched individually.** `PUT /billings/{id}` ignores `items`. `mf_update_billing` works around this by deleting and re-posting every line, which is not atomic.
- **A billing's partner cannot be changed.** The API contract has no `partner_id` on update; recreate the document instead.
- **A partner with several departments needs `department_id`.** Rather than silently picking the first one, `mf_create_billing` and `mf_create_quote` return the list and ask you to choose.
- **No memo/description search.** Journals and billings can be filtered by date, account, and similar fields only, so de-duplicating by an idempotency key in a memo means fetching a range and filtering client-side.
- **Accounting trade partners are read-only.** There is no create tool; register new partners in the web UI.
- **Amounts come back as numeric strings** (e.g. `"123456.0"`), and payment status is asymmetric — Japanese strings on read, `"0"`/`"1"`/`"2"` on write.
- **Expense API response types are loosely defined.** They are validated against real responses as cases are encountered.

## Development

```bash
npm install
npm run build
npm test         # unit tests, no credentials needed
npm run smoke    # stdio handshake + tools/list, no credentials needed
```

`npm test` covers the path-parameter validator, the OAuth callback's state-before-error ordering and loopback binding, the invoice line-item guard, the receipt-path guard, and the configuration validators. `npm run smoke` starts the built server, completes an MCP handshake, and checks that every tool is listed with a name, a description and a schema — it verifies presence, not that each schema is semantically correct. See `CONTRIBUTING.md` for how to add a tool.

## Requirements

- Node.js 20 or newer
- A MoneyForward Cloud subscription for each product you use, with API access

## License

MIT. This project is a fork of [tera911/mf-invoice-mcp](https://github.com/tera911/mf-invoice-mcp) (MIT), extended with the Expense and Accounting modules. See `LICENSE` for the retained copyright notices.
