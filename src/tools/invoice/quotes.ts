import { z } from 'zod';
import {
  listQuotes,
  getQuote,
  createQuote,
  updateQuote,
  downloadQuotePdf,
  convertQuoteToBilling,
} from '../../api/invoice/quotes.js';
import { listPartnerDepartments } from '../../api/invoice/partners.js';
import type { QuoteStatus, InvoiceTemplateLineItem } from '../../types/index.js';
import { formatMoney, formatQuantity } from './format.js';

const invoiceTemplateLineItemSchema = z.object({
  item_id: z.string().optional().describe('品目ID（マスタから選択する場合）'),
  name: z.string().optional().describe('品目名'),
  detail: z.string().optional().describe('詳細・摘要'),
  unit: z.string().optional().describe('単位'),
  price: z.number().describe('単価'),
  quantity: z.number().describe('数量'),
  is_deduct_withholding_tax: z.boolean().optional().describe('源泉徴収対象（個人事業主のみ）'),
  excise: z.enum(['untaxable', 'non_taxable', 'tax_exemption', 'five_percent', 'eight_percent', 'eight_percent_as_reduced_tax_rate', 'ten_percent']).describe('消費税区分（ten_percent: 10%, eight_percent_as_reduced_tax_rate: 軽減8%）'),
});

const statusLabels: Record<QuoteStatus, string> = {
  draft: '下書き',
  sent: '送付済み',
  accepted: '承認済み',
  rejected: '却下',
  cancelled: 'キャンセル',
};

/**
 * 書類に載せる department_id を決める。
 *
 * **department_id が明示されても、それが partner_id の部署であることを必ず確認する。**
 * 確認せずに採用すると、partner_id を無視して**別の取引先宛の書類**を作れてしまう。
 * 省略時は部署が 1 件ならそれを使い、複数あるときは選択を促してエラーにする
 * （先頭を黙って採用すると、意図しない部署宛の書類が出来上がる）。
 */
async function resolveDepartmentId(partnerId: string, departmentId?: string): Promise<string> {
  const departments = await listPartnerDepartments(partnerId);
  const list = departments.data ?? [];
  if (departmentId !== undefined) {
    if (!list.some((department) => department.id === departmentId)) {
      throw new Error(
        '指定された department_id はこの取引先の部署ではありません。'
          + 'partner_id と department_id を確認してください。'
      );
    }
    return departmentId;
  }
  if (list.length === 0) {
    throw new Error('取引先に部署が登録されていません。取引先設定を確認してください。');
  }
  if (list.length > 1) {
    const choices = list
      .map((d) => `- ${d.id}: ${d.name || '(名称なし)'}`)
      .join('\n');
    throw new Error(
      `取引先に部署が ${list.length} 件あります。department_id を指定してください:\n${choices}`
    );
  }
  return list[0].id;
}

export const quoteTools = {
  mf_list_quotes: {
    description: '見積書一覧を取得します。取引先や期間で絞り込み可能です。',
    inputSchema: z.object({
      page: z.number().optional().describe('ページ番号'),
      per_page: z.number().optional().describe('1ページあたりの件数'),
      partner_id: z.string().optional().describe('取引先IDで絞り込み'),
      status: z
        .enum(['draft', 'sent', 'accepted', 'rejected', 'cancelled'])
        .optional()
        .describe('ステータスで絞り込み'),
      from: z.string().optional().describe('見積日の開始日（YYYY-MM-DD）'),
      to: z.string().optional().describe('見積日の終了日（YYYY-MM-DD）'),
      q: z.string().optional().describe('検索キーワード'),
    }),
    handler: async (args: {
      page?: number;
      per_page?: number;
      partner_id?: string;
      status?: QuoteStatus;
      from?: string;
      to?: string;
      q?: string;
    }) => {
      try {
        const result = await listQuotes(args);

        const quotesText = result.data
          .map(
            (q) =>
              `- ${q.quote_number || 'No.'}\n  ${q.partner_name || '取引先未設定'}\n  タイトル: ${q.title || '-'}\n  見積日: ${q.quote_date || '-'}\n  合計: ${formatMoney(q.total_price)}\n  状態: ${statusLabels[q.status] || q.status}\n  ID: ${q.id}`
          )
          .join('\n\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `見積書一覧 (${result.pagination.current_page}/${result.pagination.total_pages}ページ, 全${result.pagination.total_count}件)\n\n${quotesText || '見積書が見つかりません'}`,
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

  mf_get_quote: {
    description: '見積書の詳細情報を取得します',
    inputSchema: z.object({
      quote_id: z.string().describe('見積書ID'),
    }),
    handler: async (args: { quote_id: string }) => {
      try {
        const quote = await getQuote(args.quote_id);

        const itemsText = quote.items
          .map(
            (i, idx) =>
              `  ${idx + 1}. ${i.name}\n     単価: ${formatMoney(i.price)} × ${formatQuantity(i.quantity)}${i.unit || ''} = ${formatMoney(Number(i.price) * Number(i.quantity))}`
          )
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `見積書詳細\n\n見積番号: ${quote.quote_number || '-'}\nID: ${quote.id}\n取引先: ${quote.partner_name || '-'}\nタイトル: ${quote.title || '-'}\n見積日: ${quote.quote_date || '-'}\n有効期限: ${quote.expired_date || '-'}\n状態: ${statusLabels[quote.status] || quote.status}\n\n【明細】\n${itemsText || '明細なし'}\n\n小計: ${formatMoney(quote.subtotal_price)}\n消費税: ${formatMoney(quote.excise_price)}\n合計: ${formatMoney(quote.total_price)}\n\nメモ: ${quote.memo || '-'}\n\n作成日: ${quote.created_at}\n更新日: ${quote.updated_at}`,
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

  mf_create_quote: {
    description: 'インボイス制度対応の見積書を作成します',
    inputSchema: z.object({
      partner_id: z.string().describe('取引先ID（必須）'),
      department_id: z
        .string()
        .optional()
        .describe(
          '取引先の部署ID。指定した場合もこの partner_id の部署であることを検証する'
          + '（他の取引先の部署IDは拒否）。省略時は部署が 1 件ならそれを使い、複数ある場合はエラーで一覧を返す'
        ),
      title: z.string().optional().describe('見積書タイトル'),
      memo: z.string().optional().describe('メモ'),
      quote_date: z.string().describe('見積日（YYYY-MM-DD）'),
      expired_date: z.string().describe('有効期限（YYYY-MM-DD）'),
      items: z.array(invoiceTemplateLineItemSchema).describe('明細行'),
    }),
    handler: async (args: {
      partner_id: string;
      department_id?: string;
      title?: string;
      memo?: string;
      quote_date: string;
      expired_date: string;
      items: InvoiceTemplateLineItem[];
    }) => {
      try {
        // department_id の決定。明示された場合も partner_id の部署か検証する。
        const departmentId = await resolveDepartmentId(args.partner_id, args.department_id);

        // 見積書を作成
        const quote = await createQuote({
          department_id: departmentId,
          quote_date: args.quote_date,
          expired_date: args.expired_date,
          title: args.title,
          memo: args.memo,
          items: args.items,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: `見積書を作成しました\n\n見積番号: ${quote.quote_number || '-'}\nID: ${quote.id}\n取引先: ${quote.partner_name || '-'}\n合計: ${formatMoney(quote.total_price)}`,
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

  mf_update_quote: {
    description: '見積書を更新します',
    inputSchema: z.object({
      quote_id: z.string().describe('見積書ID'),
      title: z.string().optional().describe('見積書タイトル'),
      memo: z.string().optional().describe('メモ'),
      quote_date: z.string().optional().describe('見積日（YYYY-MM-DD）'),
      expired_date: z.string().optional().describe('有効期限（YYYY-MM-DD）'),
      items: z.array(invoiceTemplateLineItemSchema).optional().describe('明細行（指定時は全置換）'),
    }),
    handler: async (args: {
      quote_id: string;
      title?: string;
      memo?: string;
      quote_date?: string;
      expired_date?: string;
      items?: InvoiceTemplateLineItem[];
    }) => {
      try {
        const { quote_id, ...params } = args;
        const quote = await updateQuote(quote_id, params);

        return {
          content: [
            {
              type: 'text' as const,
              text: `見積書を更新しました\n\n見積番号: ${quote.quote_number || '-'}\nID: ${quote.id}\n取引先: ${quote.partner_name || '-'}\n合計: ${formatMoney(quote.total_price)}`,
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

  mf_download_quote_pdf: {
    description: '見積書のPDF URLを取得します',
    inputSchema: z.object({
      quote_id: z.string().describe('見積書ID'),
    }),
    handler: async (args: { quote_id: string }) => {
      try {
        const result = await downloadQuotePdf(args.quote_id);

        return {
          content: [
            {
              type: 'text' as const,
              text: `見積書PDF URL:\n${result.pdf_url}`,
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

  mf_convert_quote_to_billing: {
    description: '見積書を請求書に変換します',
    inputSchema: z.object({
      quote_id: z.string().describe('見積書ID'),
    }),
    handler: async (args: { quote_id: string }) => {
      try {
        const billing = await convertQuoteToBilling(args.quote_id);

        return {
          content: [
            {
              type: 'text' as const,
              text: `見積書を請求書に変換しました\n\n請求番号: ${billing.billing_number || '-'}\nID: ${billing.id}\n取引先: ${billing.partner_name || '-'}\n合計: ${formatMoney(billing.total_price)}`,
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
