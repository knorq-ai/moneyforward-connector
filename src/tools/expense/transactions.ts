import { z } from 'zod';
import {
  listMyExTransactions,
  getExTransaction,
  createExTransaction,
  updateExTransaction,
  deleteExTransaction,
} from '../../api/expense/transactions.js';
import type { ExTransaction } from '../../types/index.js';

function formatTransaction(t: ExTransaction): string {
  return [
    `- No.${t.number} ${t.remark || '(摘要なし)'}`,
    `  金額: ¥${t.value.toLocaleString()}`,
    `  日付: ${t.recognized_at || '-'}`,
    `  科目: ${t.ex_item?.name || '-'}`,
    `  税区分: ${t.dr_excise?.long_name || '-'}`,
    t.dept ? `  部門: ${t.dept.name}` : null,
    t.project ? `  プロジェクト: ${t.project.name}` : null,
    t.ex_report ? `  申請: ${t.ex_report.title || '-'} (${t.ex_report.status || '-'})` : null,
    t.mf_file ? `  添付: ${t.mf_file.name}` : null,
    `  ID: ${t.id}`,
  ].filter(Boolean).join('\n');
}

export const expenseTransactionTools = {
  mf_expense_list_transactions: {
    description: '自分の経費明細一覧を取得します',
    inputSchema: z.object({
      office_id: z.string().describe('事業者ID'),
      page: z.number().optional().describe('ページ番号'),
      limit: z.number().optional().describe('取得件数（最大1000）'),
      recognized_at_from: z.string().optional().describe('日付の開始日（YYYY-MM-DD）'),
      recognized_at_to: z.string().optional().describe('日付の終了日（YYYY-MM-DD）'),
      is_reported: z.boolean().optional().describe('申請に含まれるかで絞り込み（false=未申請のみ）'),
    }),
    handler: async (args: {
      office_id: string;
      page?: number;
      limit?: number;
      recognized_at_from?: string;
      recognized_at_to?: string;
      is_reported?: boolean;
    }) => {
      try {
        const { office_id, ...params } = args;
        const transactions = await listMyExTransactions(office_id, params);

        const text = transactions.map(formatTransaction).join('\n\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `経費明細一覧 (${transactions.length}件)\n\n${text || '経費明細が見つかりません'}`,
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

  mf_expense_get_transaction: {
    description: '経費明細の詳細を取得します',
    inputSchema: z.object({
      office_id: z.string().describe('事業者ID'),
      transaction_id: z.string().describe('経費明細ID'),
    }),
    handler: async (args: { office_id: string; transaction_id: string }) => {
      try {
        const t = await getExTransaction(args.office_id, args.transaction_id);

        const lines = [
          `経費明細詳細`,
          ``,
          `ID: ${t.id}`,
          `No: ${t.number}`,
          `摘要: ${t.remark || '-'}`,
          `金額: ¥${t.value.toLocaleString()}`,
          `通貨: ${t.currency || 'JPY'}`,
          `日付: ${t.recognized_at || '-'}`,
          `科目: ${t.ex_item?.name || '-'}`,
          `税区分: ${t.dr_excise?.long_name || '-'}`,
          `貸方: ${t.cr_item?.name || '-'}${t.cr_sub_item ? ` / ${t.cr_sub_item.name}` : ''}`,
          `部門: ${t.dept?.name || '-'}`,
          `プロジェクト: ${t.project?.name || '-'}`,
          `メモ: ${t.memo || '-'}`,
          `ステータス: ${t.automatic_status || '-'}`,
          t.ex_report ? `申請: ${t.ex_report.title || '-'} (No.${t.ex_report.number}, ${t.ex_report.status})` : `申請: 未申請`,
          t.mf_file ? `添付ファイル: ${t.mf_file.name} (${t.mf_file.content_type})` : `添付ファイル: なし`,
          ``,
          `作成日: ${t.created_at || '-'}`,
          `更新日: ${t.updated_at || '-'}`,
        ];

        return {
          content: [
            {
              type: 'text' as const,
              text: lines.join('\n'),
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

  mf_expense_create_transaction: {
    description: '経費明細を作成します',
    inputSchema: z.object({
      office_id: z.string().describe('事業者ID'),
      value: z.number().describe('金額'),
      recognized_at: z.string().describe('日付（YYYY-MM-DD）'),
      ex_item_id: z.string().optional().describe('経費科目ID'),
      dr_excise_id: z.string().optional().describe('税区分ID'),
      dept_id: z.string().optional().describe('部門ID'),
      project_id: z.string().optional().describe('プロジェクトID'),
      remark: z.string().optional().describe('摘要'),
      memo: z.string().optional().describe('メモ'),
    }),
    handler: async (args: {
      office_id: string;
      value: number;
      recognized_at: string;
      ex_item_id?: string;
      dr_excise_id?: string;
      dept_id?: string;
      project_id?: string;
      remark?: string;
      memo?: string;
    }) => {
      try {
        const t = await createExTransaction(args);

        return {
          content: [
            {
              type: 'text' as const,
              text: `経費明細を作成しました\n\nID: ${t.id}\nNo: ${t.number}\n摘要: ${t.remark || '-'}\n金額: ¥${t.value.toLocaleString()}\n日付: ${t.recognized_at || '-'}`,
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

  mf_expense_update_transaction: {
    description: '経費明細を更新します',
    inputSchema: z.object({
      office_id: z.string().describe('事業者ID'),
      transaction_id: z.string().describe('経費明細ID'),
      value: z.number().optional().describe('金額'),
      recognized_at: z.string().optional().describe('日付（YYYY-MM-DD）'),
      ex_item_id: z.string().optional().describe('経費科目ID'),
      dr_excise_id: z.string().optional().describe('税区分ID'),
      dept_id: z.string().optional().describe('部門ID'),
      project_id: z.string().optional().describe('プロジェクトID'),
      remark: z.string().optional().describe('摘要'),
      memo: z.string().optional().describe('メモ'),
    }),
    handler: async (args: {
      office_id: string;
      transaction_id: string;
      value?: number;
      recognized_at?: string;
      ex_item_id?: string;
      dr_excise_id?: string;
      dept_id?: string;
      project_id?: string;
      remark?: string;
      memo?: string;
    }) => {
      try {
        const { office_id, transaction_id, ...params } = args;
        const t = await updateExTransaction(office_id, transaction_id, params);

        return {
          content: [
            {
              type: 'text' as const,
              text: `経費明細を更新しました\n\nID: ${t.id}\nNo: ${t.number}\n摘要: ${t.remark || '-'}\n金額: ¥${t.value.toLocaleString()}\n日付: ${t.recognized_at || '-'}`,
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

  mf_expense_delete_transaction: {
    description:
      '経費明細を削除します。**元に戻せません**（コネクタに undo はありません）。実行前に対象の明細 ID・日付・金額・摘要をユーザーへ提示して確認を取ってください。',
    inputSchema: z.object({
      office_id: z.string().describe('事業者ID'),
      transaction_id: z.string().describe('経費明細ID'),
    }),
    handler: async (args: { office_id: string; transaction_id: string }) => {
      try {
        await deleteExTransaction(args.office_id, args.transaction_id);

        return {
          content: [
            {
              type: 'text' as const,
              text: `経費明細を削除しました (ID: ${args.transaction_id})`,
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
