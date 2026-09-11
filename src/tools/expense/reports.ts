import { z } from 'zod';
import {
  listMyExReports,
  getExReport,
  listAllReportTransactions,
  approveExReport,
  disapproveExReport,
} from '../../api/expense/reports.js';
import type { ExTransaction } from '../../types/index.js';

function formatTransaction(t: ExTransaction, idx: number): string {
  return `  ${idx + 1}. ${t.remark || '(摘要なし)'}\n     金額: ¥${t.value.toLocaleString()}  日付: ${t.recognized_at || '-'}  科目: ${t.ex_item?.name || '-'}`;
}

export const expenseReportTools = {
  mf_expense_list_reports: {
    description: '自分の経費申請一覧を取得します',
    inputSchema: z.object({
      office_id: z.string().describe('事業者ID'),
      page: z.number().optional().describe('ページ番号'),
      limit: z.number().optional().describe('取得件数（最大1000）'),
    }),
    handler: async (args: {
      office_id: string;
      page?: number;
      limit?: number;
    }) => {
      try {
        const reports = await listMyExReports(args.office_id, {
          page: args.page,
          limit: args.limit,
        });

        const text = reports
          .map(
            (r) =>
              `- ${r.title || '(タイトルなし)'}\n  No: ${r.number || '-'}\n  金額: ¥${(r.total_value ?? 0).toLocaleString()}\n  状態: ${r.status || '-'}\n  ID: ${r.id}`
          )
          .join('\n\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `経費申請一覧 (${reports.length}件)\n\n${text || '経費申請が見つかりません'}`,
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

  mf_expense_get_report: {
    description: '経費申請の詳細と明細を取得します',
    inputSchema: z.object({
      office_id: z.string().describe('事業者ID'),
      report_id: z.string().describe('経費申請ID'),
    }),
    handler: async (args: { office_id: string; report_id: string }) => {
      try {
        const [r, page] = await Promise.all([
          getExReport(args.office_id, args.report_id),
          listAllReportTransactions(args.office_id, args.report_id),
        ]);
        const { transactions, complete } = page;

        const total = transactions.reduce((sum, t) => sum + t.value, 0);
        const totalLabel = complete
          ? `合計: ¥${total.toLocaleString()}`
          : `合計: ¥${total.toLocaleString()} ⚠️ 明細が多く取得を打ち切りました。表示分のみの小計です`;
        const transText = transactions.length > 0
          ? transactions.map((t, idx) => formatTransaction(t, idx)).join('\n')
          : '明細なし';

        return {
          content: [
            {
              type: 'text' as const,
              text: `経費申請詳細\n\nID: ${r.id}\nタイトル: ${r.title || '-'}\nNo: ${r.number || '-'}\n状態: ${r.status || '-'}\n明細件数: ${transactions.length}件${complete ? '' : '以上'}\n${totalLabel}\n提出日: ${r.submitted_at || '-'}\n承認日: ${r.approved_at || '-'}\n\n【明細】\n${transText}\n\n作成日: ${r.created_at || '-'}\n更新日: ${r.updated_at || '-'}`,
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

  mf_expense_approve_report: {
    description: '経費申請を承認します',
    inputSchema: z.object({
      office_id: z.string().describe('事業者ID'),
      report_id: z.string().describe('経費申請ID'),
    }),
    handler: async (args: { office_id: string; report_id: string }) => {
      try {
        const r = await approveExReport(args.office_id, args.report_id);

        return {
          content: [
            {
              type: 'text' as const,
              text: `経費申請を承認しました\n\nID: ${r.id}\nタイトル: ${r.title || '-'}\n状態: ${r.status || '-'}`,
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

  mf_expense_disapprove_report: {
    description: '経費申請を却下します',
    inputSchema: z.object({
      office_id: z.string().describe('事業者ID'),
      report_id: z.string().describe('経費申請ID'),
    }),
    handler: async (args: { office_id: string; report_id: string }) => {
      try {
        const r = await disapproveExReport(args.office_id, args.report_id);

        return {
          content: [
            {
              type: 'text' as const,
              text: `経費申請を却下しました\n\nID: ${r.id}\nタイトル: ${r.title || '-'}\n状態: ${r.status || '-'}`,
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
