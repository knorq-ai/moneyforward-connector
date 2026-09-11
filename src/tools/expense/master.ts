import { z } from 'zod';
import { listExItems, listDepts, listProjects } from '../../api/expense/master.js';

export const expenseMasterTools = {
  mf_expense_list_ex_items: {
    description: '経費科目一覧を取得します',
    inputSchema: z.object({
      office_id: z.string().describe('事業者ID'),
    }),
    handler: async (args: { office_id: string }) => {
      try {
        const items = await listExItems(args.office_id);

        const text = items
          .map(
            (i) => `- ${i.name}${i.code ? ` (${i.code})` : ''}\n  ID: ${i.id}`
          )
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `経費科目一覧 (${items.length}件)\n\n${text || '経費科目が見つかりません'}`,
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

  mf_expense_list_depts: {
    description: '部門一覧を取得します',
    inputSchema: z.object({
      office_id: z.string().describe('事業者ID'),
    }),
    handler: async (args: { office_id: string }) => {
      try {
        const depts = await listDepts(args.office_id);

        const text = depts
          .map((d) => `- ${d.name}${d.code ? ` (${d.code})` : ''}\n  ID: ${d.id}`)
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `部門一覧 (${depts.length}件)\n\n${text || '部門が見つかりません'}`,
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

  mf_expense_list_projects: {
    description: 'プロジェクト一覧を取得します',
    inputSchema: z.object({
      office_id: z.string().describe('事業者ID'),
    }),
    handler: async (args: { office_id: string }) => {
      try {
        const projects = await listProjects(args.office_id);

        const text = projects
          .map((p) => `- ${p.name}${p.code ? ` (${p.code})` : ''}\n  ID: ${p.id}`)
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `プロジェクト一覧 (${projects.length}件)\n\n${text || 'プロジェクトが見つかりません'}`,
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
