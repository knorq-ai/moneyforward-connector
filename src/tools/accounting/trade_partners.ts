import { z } from 'zod';
import { listTradePartners } from '../../api/accounting/trade_partners.js';

export const accountingTradePartnerTools = {
  mf_accounting_list_trade_partners: {
    description: '取引先一覧を取得する（会計）',
    inputSchema: z.object({
      available: z.boolean().optional().describe('有効な取引先のみ取得する場合 true'),
    }),
    handler: async (args: { available?: boolean }) => {
      try {
        const result = await listTradePartners(args);

        const partnersText = result.trade_partners
          .map((p) => {
            const inv = p.invoice_registration_number
              ? ` invoice=${p.invoice_registration_number}`
              : '';
            const corp = p.corporate_number ? ` corp=${p.corporate_number}` : '';
            return `- ${p.name} (code=${p.code || '-'}) ${p.available ? '有効' : '無効'}${inv}${corp}`;
          })
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `取引先一覧 (${result.trade_partners.length}件)\n\n${partnersText || '取引先がない'}`,
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
