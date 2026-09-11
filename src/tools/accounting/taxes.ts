import { z } from 'zod';
import { listTaxes } from '../../api/accounting/taxes.js';

export const accountingTaxTools = {
  mf_accounting_list_taxes: {
    description: '税区分一覧を取得する',
    inputSchema: z.object({
      available: z.boolean().optional().describe('有効な税区分のみ取得する場合 true'),
    }),
    handler: async (args: { available?: boolean }) => {
      try {
        const result = await listTaxes(args);

        const taxesText = result.taxes
          .map((t) => {
            const rate = t.tax_rate !== null ? ` rate=${t.tax_rate}` : '';
            return `- ${t.name} (${t.abbreviation})${rate} ${t.available ? '有効' : '無効'}\n  ID: ${t.id}`;
          })
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `税区分一覧 (${result.taxes.length}件)\n\n${taxesText || '該当する税区分がない'}`,
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
