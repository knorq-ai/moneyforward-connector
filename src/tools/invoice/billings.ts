import { z } from 'zod';
import {
  listBillings,
  getBilling,
  createInvoiceTemplateBilling,
  createBillingFromQuote,
  updateBilling,
  deleteBilling,
  replaceBillingItems,
  updatePaymentStatus,
  downloadBillingPdf,
} from '../../api/invoice/billings.js';
import { listPartnerDepartments } from '../../api/invoice/partners.js';
import { formatMoney, formatQuantity } from './format.js';
import type {
  BillingRangeKey,
  PaymentStatusCode,
  AddBillingItemParams,
  InvoiceTemplateLineItem,
} from '../../types/index.js';

/**
 * 明細の置換に使うスキーマ。
 *
 * `item_id` を指定しない場合、API は `name` と `excise` を要求する。ここを
 * optional のままにすると、検証を通った不正な明細で既存明細が消えてから
 * 422 になる（= 明細が全部消えた請求書が残る）ため、refine で弾く。
 */
const billingItemSchema = z
  .object({
    item_id: z
      .string()
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/, 'item_id の形式が不正です')
      .optional()
      .describe('品目ID（マスタから選択する場合。name / excise とは併用できない）'),
    name: z
      .string()
      .regex(/\S/, 'name は空白以外の文字で指定してください')
      .optional()
      .describe('品目名（item_id を指定しない場合は必須）'),
    delivery_number: z.string().optional().describe('納品番号'),
    delivery_date: z.string().optional().describe('納品日（YYYY-MM-DD）'),
    detail: z.string().optional().describe('詳細・摘要'),
    unit: z.string().optional().describe('単位'),
    price: z.number().finite().describe('単価'),
    quantity: z.number().finite().describe('数量'),
    is_deduct_withholding_tax: z.boolean().optional().describe('源泉徴収対象'),
    excise: z
      .enum(['untaxable', 'non_taxable', 'tax_exemption', 'five_percent', 'eight_percent', 'eight_percent_as_reduced_tax_rate', 'ten_percent'])
      .optional()
      .describe('消費税区分（item_id を指定しない場合は必須）'),
  })
  .superRefine((item, ctx) => {
    // item_id と手入力（name / excise）は XOR。併用を許すと、どちらが効くのか
    // 呼び出し側から分からないまま既存明細が消える。
    if (item.item_id !== undefined) {
      if (item.name !== undefined || item.excise !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['item_id'],
          message: 'item_id を指定する場合は name と excise を指定できません',
        });
      }
      return;
    }
    if (!item.name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: 'item_id を指定しない場合は name が必須です',
      });
    }
    if (!item.excise) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['excise'],
        message: 'item_id を指定しない場合は excise（消費税区分）が必須です',
      });
    }
  });

const invoiceTemplateLineItemSchema = z.object({
  item_id: z.string().optional().describe('品目ID（マスタから選択する場合）'),
  name: z.string().optional().describe('品目名'),
  delivery_number: z.string().optional().describe('納品番号'),
  delivery_date: z.string().optional().describe('納品日（YYYY-MM-DD）'),
  detail: z.string().optional().describe('詳細・摘要'),
  unit: z.string().optional().describe('単位'),
  price: z.number().describe('単価'),
  quantity: z.number().describe('数量'),
  is_deduct_withholding_tax: z.boolean().optional().describe('源泉徴収対象（個人事業主のみ）'),
  excise: z.enum(['untaxable', 'non_taxable', 'tax_exemption', 'five_percent', 'eight_percent', 'eight_percent_as_reduced_tax_rate', 'ten_percent']).describe('消費税区分（ten_percent: 10%, eight_percent_as_reduced_tax_rate: 軽減8%）'),
});

// 書き込み用のコード → 表示ラベル。読み取り時 API は日本語文字列をそのまま返す。
const paymentStatusCodeLabels: Record<PaymentStatusCode, string> = {
  '0': '未設定',
  '1': '未入金',
  '2': '入金済み',
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

export const billingTools = {
  mf_list_billings: {
    description: '請求書一覧を取得します。取引先や期間で絞り込み可能です。',
    inputSchema: z.object({
      page: z.number().optional().describe('ページ番号'),
      per_page: z.number().optional().describe('1ページあたりの件数（最大100）'),
      partner_id: z.string().optional().describe('取引先IDで絞り込み'),
      status: z.string().optional().describe('書類ステータスで絞り込み（例: 下書き / ロック中 / 未ロック）'),
      document_number: z.string().optional().describe('請求書番号で絞り込み'),
      partner_name: z.string().optional().describe('取引先名で絞り込み'),
      tags: z.string().optional().describe('タグで絞り込み'),
      range_key: z
        .enum(['billing_date', 'due_date', 'sales_date', 'created_at', 'updated_at'])
        .optional()
        .describe('from/to の対象日付項目。省略時は billing_date（請求日）'),
      from: z.string().optional().describe('期間の開始日（YYYY-MM-DD）'),
      to: z.string().optional().describe('期間の終了日（YYYY-MM-DD）'),
      q: z.string().optional().describe('検索キーワード（指定すると document_number/status/partner_name/tags は無視される）'),
    }),
    handler: async (args: {
      page?: number;
      per_page?: number;
      partner_id?: string;
      status?: string;
      document_number?: string;
      partner_name?: string;
      tags?: string;
      range_key?: BillingRangeKey;
      from?: string;
      to?: string;
      q?: string;
    }) => {
      try {
        const result = await listBillings(args);

        const billingsText = result.data
          .map(
            (b) =>
              `- ${b.billing_number || 'No.'}\n  ${b.partner_name || '取引先未設定'}\n  タイトル: ${b.title || '-'}\n  請求日: ${b.billing_date || '-'}\n  支払期限: ${b.due_date || '-'}\n  合計: ${formatMoney(b.total_price)}\n  入金状態: ${b.payment_status || '-'}\n  ID: ${b.id}`
          )
          .join('\n\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `請求書一覧 (${result.pagination.current_page}/${result.pagination.total_pages}ページ, 全${result.pagination.total_count}件)\n\n${billingsText || '請求書が見つかりません'}`,
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

  mf_get_billing: {
    description: '請求書の詳細情報を取得します',
    inputSchema: z.object({
      billing_id: z.string().describe('請求書ID'),
    }),
    handler: async (args: { billing_id: string }) => {
      try {
        const billing = await getBilling(args.billing_id);

        const itemsText = billing.items
          .map(
            (i, idx) =>
              `  ${idx + 1}. ${i.name}\n     単価: ${formatMoney(i.price)} × ${formatQuantity(i.quantity)}${i.unit || ''} = ${formatMoney(Number(i.price) * Number(i.quantity))}`
          )
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `請求書詳細\n\n請求番号: ${billing.billing_number || '-'}\nID: ${billing.id}\n取引先: ${billing.partner_name || '-'}\nタイトル: ${billing.title || '-'}\n請求日: ${billing.billing_date || '-'}\n売上日: ${billing.sales_date || '-'}\n支払期限: ${billing.due_date || '-'}\n入金状態: ${billing.payment_status || '-'}\n支払条件: ${billing.payment_condition || '-'}\n\n【明細】\n${itemsText || '明細なし'}\n\n小計: ${formatMoney(billing.subtotal_price)}\n消費税: ${formatMoney(billing.excise_price)}\n合計: ${formatMoney(billing.total_price)}\n\nメモ: ${billing.memo || '-'}\n\n作成日: ${billing.created_at}\n更新日: ${billing.updated_at}`,
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

  mf_create_billing: {
    description: 'インボイス制度対応の請求書を作成します',
    inputSchema: z.object({
      partner_id: z.string().describe('取引先ID（必須）'),
      department_id: z
        .string()
        .optional()
        .describe(
          '取引先の部署ID。指定した場合もこの partner_id の部署であることを検証する'
          + '（他の取引先の部署IDは拒否）。省略時は部署が 1 件ならそれを使い、複数ある場合はエラーで一覧を返す'
        ),
      title: z.string().optional().describe('請求書タイトル'),
      memo: z.string().optional().describe('メモ'),
      payment_condition: z.string().optional().describe('支払条件'),
      billing_date: z.string().describe('請求日（YYYY-MM-DD）'),
      due_date: z.string().optional().describe('支払期限（YYYY-MM-DD）'),
      sales_date: z.string().optional().describe('売上日（YYYY-MM-DD）'),
      items: z.array(invoiceTemplateLineItemSchema).describe('明細行'),
    }),
    handler: async (args: {
      partner_id: string;
      department_id?: string;
      title?: string;
      memo?: string;
      payment_condition?: string;
      billing_date: string;
      due_date?: string;
      sales_date?: string;
      items: InvoiceTemplateLineItem[];
    }) => {
      try {
        // department_id の決定。明示された場合も partner_id の部署か検証する。
        const departmentId = await resolveDepartmentId(args.partner_id, args.department_id);

        // インボイス制度対応の請求書を作成
        const billing = await createInvoiceTemplateBilling({
          department_id: departmentId,
          billing_date: args.billing_date,
          due_date: args.due_date,
          sales_date: args.sales_date,
          title: args.title,
          memo: args.memo,
          payment_condition: args.payment_condition,
          items: args.items,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: `請求書を作成しました\n\n請求番号: ${billing.billing_number || '-'}\nID: ${billing.id}\n取引先: ${billing.partner_name || '-'}\n合計: ${formatMoney(billing.total_price)}`,
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

  mf_create_billing_from_quote: {
    description: '見積書から請求書を作成します',
    inputSchema: z.object({
      quote_id: z.string().describe('元となる見積書のID'),
      billing_date: z.string().optional().describe('請求日（YYYY-MM-DD）'),
      due_date: z.string().optional().describe('支払期限（YYYY-MM-DD）'),
      sales_date: z.string().optional().describe('売上日（YYYY-MM-DD）'),
      title: z.string().optional().describe('請求書タイトル'),
      memo: z.string().optional().describe('メモ'),
      payment_condition: z.string().optional().describe('支払条件'),
    }),
    handler: async (args: {
      quote_id: string;
      billing_date?: string;
      due_date?: string;
      sales_date?: string;
      title?: string;
      memo?: string;
      payment_condition?: string;
    }) => {
      try {
        const billing = await createBillingFromQuote(args);

        return {
          content: [
            {
              type: 'text' as const,
              text: `見積書から請求書を作成しました\n\n請求番号: ${billing.billing_number || '-'}\nID: ${billing.id}\n取引先: ${billing.partner_name || '-'}\n合計: ${formatMoney(billing.total_price)}`,
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

  mf_update_billing: {
    description:
      '請求書を更新します。items を指定すると明細を全置換します（既存明細を削除してから追加するため、途中で失敗すると明細が欠けた状態になり得ます）。取引先の変更は API 非対応です。',
    inputSchema: z.object({
      billing_id: z.string().describe('請求書ID'),
      department_id: z.string().optional().describe('取引先の部署ID'),
      title: z.string().optional().describe('請求書タイトル'),
      memo: z.string().optional().describe('メモ'),
      payment_condition: z.string().optional().describe('支払条件'),
      billing_date: z.string().optional().describe('請求日（YYYY-MM-DD）'),
      due_date: z.string().optional().describe('支払期限（YYYY-MM-DD）'),
      sales_date: z.string().optional().describe('売上日（YYYY-MM-DD）'),
      billing_number: z.string().optional().describe('請求書番号'),
      note: z.string().optional().describe('備考'),
      document_name: z.string().optional().describe('書類名'),
      tag_names: z.array(z.string()).optional().describe('タグ'),
      items: z.array(billingItemSchema).min(1).optional().describe('明細行（指定時は全置換。空配列は不可）'),
    }),
    handler: async (args: {
      billing_id: string;
      department_id?: string;
      title?: string;
      memo?: string;
      payment_condition?: string;
      billing_date?: string;
      due_date?: string;
      sales_date?: string;
      billing_number?: string;
      note?: string;
      document_name?: string;
      tag_names?: string[];
      items?: AddBillingItemParams[];
    }) => {
      try {
        const { billing_id, items, ...headerParams } = args;

        let billing;
        if (Object.keys(headerParams).length > 0) {
          billing = await updateBilling(billing_id, headerParams);
        }
        if (items) {
          billing = await replaceBillingItems(billing_id, items);
        }
        if (!billing) {
          billing = await getBilling(billing_id);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `請求書を更新しました${items ? '（明細を全置換）' : ''}\n\n請求番号: ${billing.billing_number || '-'}\nID: ${billing.id}\n取引先: ${billing.partner_name || '-'}\n合計: ${formatMoney(billing.total_price)}`,
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

  mf_delete_billing: {
    description: '請求書を削除します。元に戻せないため、実行前に必ずユーザーへ確認してください。',
    inputSchema: z.object({
      billing_id: z.string().describe('請求書ID'),
    }),
    handler: async (args: { billing_id: string }) => {
      try {
        // 削除後は取得できないので、何を消したかを先に控えて報告に載せる
        const billing = await getBilling(args.billing_id);
        await deleteBilling(args.billing_id);

        return {
          content: [
            {
              type: 'text' as const,
              text: `請求書を削除しました\n\n請求番号: ${billing.billing_number || '-'}\nID: ${billing.id}\n取引先: ${billing.partner_name || '-'}\nタイトル: ${billing.title || '-'}\n合計: ${formatMoney(billing.total_price)}`,
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

  mf_update_payment_status: {
    description: '請求書の入金状態を更新します',
    inputSchema: z.object({
      billing_id: z.string().describe('請求書ID'),
      payment_status: z.enum(['0', '1', '2']).describe('入金状態（0: 未設定 / 1: 未入金 / 2: 入金済み）'),
    }),
    handler: async (args: { billing_id: string; payment_status: PaymentStatusCode }) => {
      try {
        const billing = await updatePaymentStatus(args);

        return {
          content: [
            {
              type: 'text' as const,
              text: `入金状態を更新しました\n\n請求番号: ${billing.billing_number || '-'}\n入金状態: ${billing.payment_status || paymentStatusCodeLabels[args.payment_status]}`,
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

  mf_download_billing_pdf: {
    description: '請求書のPDF URLを取得します',
    inputSchema: z.object({
      billing_id: z.string().describe('請求書ID'),
    }),
    handler: async (args: { billing_id: string }) => {
      try {
        const result = await downloadBillingPdf(args.billing_id);

        return {
          content: [
            {
              type: 'text' as const,
              text: `請求書PDF URL:\n${result.pdf_url}`,
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
