import * as path from 'node:path';
import * as os from 'node:os';

export interface ServiceConfig {
  name: string;
  oauth: {
    clientId: string;
    clientSecret: string;
    authorizeUrl: string;
    tokenUrl: string;
    scopes: string;
    /**
     * 任意。クライアントID/シークレットが未設定のとき、エラーメッセージに表示する
     * 環境変数名のヒント。指定しなければ `MF_<SERVICE>_CLIENT_ID / _SECRET` が使われる。
     */
    envHint?: string;
  };
  api: {
    baseUrl: string;
  };
  storage: {
    tokensFile: string;
  };
}

export type ServiceName = 'invoice' | 'expense' | 'accounting';

/**
 * トークンの保存先はモジュール読み込み時ではなく**呼び出し時**に解決する。
 *
 * モジュールスコープの const にすると、プロセス内で `HOME` を差し替えても
 * 古い値が残る。テストが実ユーザーの `~/.config/mf-mcp` を触らないためには、
 * 参照のたびに現在の `HOME` を見る必要がある（`os.homedir()` は POSIX で
 * `$HOME` を優先する）。実運用では挙動は変わらない。
 */
export function getConfigDir(): string {
  return path.join(os.homedir(), '.config', 'mf-mcp');
}

/** 移行元の旧パス（invoice のみ） */
export function getLegacyTokensFile(): string {
  return path.join(os.homedir(), '.config', 'mf-invoice-mcp', 'tokens.json');
}

export function getServiceConfig(service: ServiceName): ServiceConfig {
  switch (service) {
    case 'invoice':
      return {
        name: 'invoice',
        oauth: {
          clientId: process.env.MF_INVOICE_CLIENT_ID || process.env.MF_CLIENT_ID || '',
          clientSecret: process.env.MF_INVOICE_CLIENT_SECRET || process.env.MF_CLIENT_SECRET || '',
          authorizeUrl: 'https://api.biz.moneyforward.com/authorize',
          tokenUrl: 'https://api.biz.moneyforward.com/token',
          scopes: 'mfc/invoice/data.read mfc/invoice/data.write',
          envHint: 'MF_INVOICE_CLIENT_ID / MF_INVOICE_CLIENT_SECRET (or MF_CLIENT_ID / MF_CLIENT_SECRET)',
        },
        api: {
          baseUrl: 'https://invoice.moneyforward.com/api/v3',
        },
        storage: {
          tokensFile: path.join(getConfigDir(), 'invoice-tokens.json'),
        },
      };
    case 'expense':
      return {
        name: 'expense',
        oauth: {
          clientId: process.env.MF_EXPENSE_CLIENT_ID || '',
          clientSecret: process.env.MF_EXPENSE_CLIENT_SECRET || '',
          authorizeUrl: 'https://expense.moneyforward.com/oauth/authorize',
          tokenUrl: 'https://expense.moneyforward.com/oauth/token',
          scopes: 'office_setting:write user_setting:write transaction:write report:write account:write public_resource:read',
        },
        api: {
          baseUrl: 'https://expense.moneyforward.com/api/external/v1',
        },
        storage: {
          tokensFile: path.join(getConfigDir(), 'expense-tokens.json'),
        },
      };
    case 'accounting':
      // 認証エンドポイントは MF 統一ポータル (invoice と共通)。
      // クライアントは MF 開発者ポータルで別アプリとして新規登録。
      return {
        name: 'accounting',
        oauth: {
          clientId: process.env.MF_ACCOUNTING_CLIENT_ID || '',
          clientSecret: process.env.MF_ACCOUNTING_CLIENT_SECRET || '',
          authorizeUrl: 'https://api.biz.moneyforward.com/authorize',
          tokenUrl: 'https://api.biz.moneyforward.com/token',
          scopes: [
            'mfc/accounting/journal.read',
            'mfc/accounting/journal.write',
            'mfc/accounting/accounts.read',
            'mfc/accounting/taxes.read',
            'mfc/accounting/departments.read',
            'mfc/accounting/offices.read',
            'mfc/accounting/trade_partners.read',
          ].join(' '),
        },
        api: {
          baseUrl: 'https://api-accounting.moneyforward.com',
        },
        storage: {
          tokensFile: path.join(getConfigDir(), 'accounting-tokens.json'),
        },
      };
  }
}
