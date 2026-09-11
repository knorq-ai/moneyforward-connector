import { z } from 'zod';
import { listOffices } from '../../api/expense/offices.js';

export const expenseOfficeTools = {
  mf_expense_list_offices: {
    description: '事業者一覧を取得します',
    inputSchema: z.object({}),
    handler: async () => {
      try {
        const offices = await listOffices();

        const text = offices
          .map((o) => `- ${o.name}${o.code ? ` (${o.code})` : ''}\n  ID: ${o.id}`)
          .join('\n\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `事業者一覧 (${offices.length}件)\n\n${text || '事業者が見つかりません'}`,
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
