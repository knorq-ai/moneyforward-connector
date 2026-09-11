import { pathParam } from '../path.js';
import { getInvoiceClient } from '../client.js';
import type {
  Billing,
  BillingItem,
  ListBillingsParams,
  ListResponse,
  CreateBillingParams,
  CreateInvoiceTemplateBillingParams,
  CreateBillingFromQuoteParams,
  UpdateBillingParams,
  UpdatePaymentStatusParams,
  AddBillingItemParams,
} from '../../types/index.js';

export async function listBillings(params?: ListBillingsParams): Promise<ListResponse<Billing>> {
  // from/to は range_key とセットでないと API が 422 を返す。
  // 呼び出し側が省略した場合は請求日で絞る（最も一般的な意図）。
  const hasRange = Boolean(params?.from || params?.to);
  const rangeKey = params?.range_key ?? (hasRange ? 'billing_date' : undefined);

  return getInvoiceClient().get<ListResponse<Billing>>('/billings', {
    page: params?.page,
    per_page: params?.per_page,
    partner_id: params?.partner_id,
    status: params?.status,
    document_number: params?.document_number,
    partner_name: params?.partner_name,
    tags: params?.tags,
    range_key: rangeKey,
    from: params?.from,
    to: params?.to,
    q: params?.q,
  });
}

export async function getBilling(billingId: string): Promise<Billing> {
  return getInvoiceClient().get<Billing>(`/billings/${pathParam(billingId, 'billing_id')}`);
}

export async function createBilling(params: CreateBillingParams): Promise<Billing> {
  // v3 API の POST /billings はボディをラップせず、items も受け付けない。
  // 明細付きで作るなら createInvoiceTemplateBilling を使う。
  const { items, ...billingParams } = params;
  return getInvoiceClient().post<Billing>('/billings', billingParams);
}

// インボイス制度対応の請求書作成
export async function createInvoiceTemplateBilling(params: CreateInvoiceTemplateBillingParams): Promise<Billing> {
  return getInvoiceClient().post<Billing>('/invoice_template_billings', params);
}

export async function createBillingFromQuote(params: CreateBillingFromQuoteParams): Promise<Billing> {
  return getInvoiceClient().post<Billing>('/billings/from_quote', {
    quote_id: params.quote_id,
    billing: {
      billing_date: params.billing_date,
      due_date: params.due_date,
      sales_date: params.sales_date,
      title: params.title,
      memo: params.memo,
      payment_condition: params.payment_condition,
    },
  });
}

/**
 * 請求書のヘッダ項目を更新する。
 * items は PUT の契約に無いため、明細を変えるときは replaceBillingItems を使う。
 */
export async function updateBilling(billingId: string, params: UpdateBillingParams): Promise<Billing> {
  return getInvoiceClient().put<Billing>(`/billings/${pathParam(billingId, 'billing_id')}`, params);
}

/** 請求書を削除する。元に戻せない。 */
export async function deleteBilling(billingId: string): Promise<void> {
  await getInvoiceClient().delete<void>(`/billings/${pathParam(billingId, 'billing_id')}`);
}

export async function listBillingItems(billingId: string): Promise<ListResponse<BillingItem>> {
  return getInvoiceClient().get<ListResponse<BillingItem>>(`/billings/${pathParam(billingId, 'billing_id')}/items`);
}

export async function addBillingItem(billingId: string, item: AddBillingItemParams): Promise<BillingItem> {
  return getInvoiceClient().post<BillingItem>(`/billings/${pathParam(billingId, 'billing_id')}/items`, item);
}

export async function deleteBillingItem(billingId: string, itemId: string): Promise<void> {
  await getInvoiceClient().delete<void>(`/billings/${pathParam(billingId, 'billing_id')}/items/${pathParam(itemId, 'item_id')}`);
}

/**
 * 明細の置換リクエストを、1 件も削除する前に検証する。
 *
 * API は `item_id` を指定しない明細に `excise`（消費税区分）と `name` を要求する。
 * 検証せずに削除を始めると、既存明細を消したあとで追加が 422 になり、
 * **明細が全部消えた請求書が残る**。削除前に全件検証して、不正なら何もしない。
 */
export function validateReplacementItems(items: AddBillingItemParams[]): void {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('明細の置換には 1 件以上の明細が必要です（空配列は明細の全削除になるため拒否します）');
  }

  const excises = [
    'untaxable', 'non_taxable', 'tax_exemption', 'five_percent', 'eight_percent',
    'eight_percent_as_reduced_tax_rate', 'ten_percent',
  ];
  const problems: string[] = [];
  // Array.from で疎な配列の欠落要素も undefined として検証する。forEach は穴を飛ばす。
  Array.from(items).forEach((item, index) => {
    const at = `${index + 1}件目`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      problems.push(`${at}: 明細がオブジェクトではありません`);
      return;
    }
    if (item.item_id !== undefined) {
      try {
        pathParam(item.item_id, 'item_id');
      } catch (error) {
        problems.push(`${at}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (item.name !== undefined || item.excise !== undefined) {
        problems.push(`${at}: item_id を指定する場合は name と excise を指定できません`);
      }
    } else {
      if (item.name === undefined) problems.push(`${at}: item_id を指定しない場合は name が必須です`);
      if (!item.excise) {
        problems.push(`${at}: item_id を指定しない場合は excise（消費税区分）が必須です`);
      } else if (!excises.includes(item.excise)) {
        problems.push(`${at}: excise（消費税区分）の形式が不正です`);
      }
    }
    if (item.name !== undefined && (typeof item.name !== 'string' || item.name.trim() === '')) {
      problems.push(`${at}: name は空白以外の文字で指定してください`);
    }
    for (const field of ['delivery_number', 'delivery_date', 'detail', 'unit'] as const) {
      if (item[field] !== undefined && typeof item[field] !== 'string') {
        problems.push(`${at}: ${field} は文字列で指定してください`);
      }
    }
    if (item.is_deduct_withholding_tax !== undefined && typeof item.is_deduct_withholding_tax !== 'boolean') {
      problems.push(`${at}: is_deduct_withholding_tax は true または false で指定してください`);
    }
    if (typeof item.price !== 'number' || !Number.isFinite(item.price)) {
      problems.push(`${at}: price は数値で指定してください`);
    }
    if (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity)) {
      problems.push(`${at}: quantity は数値で指定してください`);
    }
  });

  if (problems.length > 0) {
    throw new Error(
      `明細の内容が不正なため、既存明細の削除を行いませんでした（請求書は変更されていません）:\n`
        + problems.map((p) => `- ${p}`).join('\n')
    );
  }
}

/**
 * 請求書の明細を全置換する。
 *
 * v3 API に明細の一括更新エンドポイントが無いため、既存明細を 1 件ずつ削除してから
 * 新しい明細を順に追加する。atomic ではないので:
 *
 * 1. 削除を始める前に置換内容を全件検証する（不正なら 1 件も消さない）
 * 2. 削除ループ・追加ループのどちらで失敗しても、削除前のスナップショットを
 *    エラーに含めて呼び出し側が復旧できるようにする
 */
export async function replaceBillingItems(
  billingId: string,
  items: AddBillingItemParams[]
): Promise<Billing> {
  // 1 件も削除する前に検証する。ここで throw した場合、請求書は無傷。
  validateReplacementItems(items);

  const existing = await listBillingItems(billingId);
  const snapshot = existing.data ?? [];

  const failure = (stage: string, message: string): Error =>
    new Error(
      `${stage}: ${message}\n`
        + `⚠️ 明細が中途半端な状態で残っている可能性があります。`
        + `削除前の明細内容: ${JSON.stringify(snapshot)}`
    );

  let deleted = 0;
  for (const item of snapshot) {
    if (!item.id) continue;
    try {
      await deleteBillingItem(billingId, item.id);
      deleted += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw failure(`既存明細の削除に失敗しました（${deleted}件削除済み / 全${snapshot.length}件）`, message);
    }
  }

  for (const [index, item] of items.entries()) {
    try {
      await addBillingItem(billingId, item);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw failure(`明細の追加に失敗しました（${index + 1}件目 / 全${items.length}件）`, message);
    }
  }

  return getBilling(billingId);
}

/** 入金ステータスを更新する。書き込みは "0"(未設定) / "1"(未入金) / "2"(入金済み)。 */
export async function updatePaymentStatus(params: UpdatePaymentStatusParams): Promise<Billing> {
  await getInvoiceClient().put<void>(`/billings/${pathParam(params.billing_id, 'billing_id')}/payment_status`, {
    payment_status: params.payment_status,
  });
  return getBilling(params.billing_id);
}

export async function downloadBillingPdf(billingId: string): Promise<{ pdf_url: string }> {
  const billing = await getBilling(billingId);
  if (!billing.pdf_url) {
    throw new Error('PDF URL is not available for this billing');
  }
  return { pdf_url: billing.pdf_url };
}
