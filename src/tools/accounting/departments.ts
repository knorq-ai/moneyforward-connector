import { z } from 'zod';
import { listDepartments } from '../../api/accounting/departments.js';

export const accountingDepartmentTools = {
  mf_accounting_list_departments: {
    description: '部門一覧を取得する',
    inputSchema: z.object({}),
    handler: async () => {
      try {
        const result = await listDepartments();

        const deptsText = result.departments
          .map(
            (d) =>
              `- ${d.name}\n  ID: ${d.id}\n  親部門ID: ${d.parent_id ?? '(なし)'}\n  検索キー: ${d.search_key ?? '-'}`,
          )
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `部門一覧 (${result.departments.length}件)\n\n${deptsText || '部門がない'}`,
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
