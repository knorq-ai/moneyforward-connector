import { z } from 'zod';
import { listAccounts, listSubAccounts } from '../../api/accounting/accounts.js';

export const accountingAccountTools = {
  mf_accounting_list_accounts: {
    description: '勘定科目一覧を取得する',
    inputSchema: z.object({
      available: z.boolean().optional().describe('有効な勘定科目のみ取得する場合 true'),
    }),
    handler: async (args: { available?: boolean }) => {
      try {
        const result = await listAccounts(args);

        const accountsText = result.accounts
          .map((a) => {
            const subs = a.sub_accounts.length
              ? a.sub_accounts
                  .map((s) => `    補助: ${s.name} (id=${s.id})`)
                  .join('\n')
              : '';
            return `- ${a.name} [${a.account_group}/${a.category}] ${a.available ? '有効' : '無効'}\n  ID: ${a.id}\n  tax_id: ${a.tax_id}${subs ? '\n' + subs : ''}`;
          })
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `勘定科目一覧 (${result.accounts.length}件)\n\n${accountsText || '該当する勘定科目がない'}`,
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

  mf_accounting_list_sub_accounts: {
    description: '補助科目一覧を取得する',
    inputSchema: z.object({
      account_id: z.string().optional().describe('勘定科目IDで絞り込む'),
    }),
    handler: async (args: { account_id?: string }) => {
      try {
        const result = await listSubAccounts(args);

        const subsText = result.sub_accounts
          .map(
            (s) =>
              `- ${s.name}\n  ID: ${s.id}\n  勘定科目ID: ${s.account_id}\n  tax_id: ${s.tax_id}`,
          )
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `補助科目一覧 (${result.sub_accounts.length}件)\n\n${subsText || '該当する補助科目がない'}`,
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
};
