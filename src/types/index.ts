// 共通型 re-export
export type { OAuthTokens, OAuthConfig, Pagination, ListResponse, ApiError, ApiErrorItem } from './common.js';

/**
 * 請求書 API が金額・数量を返すときの型。
 *
 * v3 API は金額系を **数値ではなく数値文字列**（例: `"123456.0"`）で返す。
 * number として扱うと `.toLocaleString()` が桁区切りされず `¥123456.0` のように
 * 出るため、表示前に必ず `formatMoney()` を通す。
 */
export type MoneyString = string;

// 経費API型 re-export
export type {
  Office,
  ExTransaction,
  ExReport,
  ExReportApproval,
  ExItem,
  Excise,
  Dept,
  Project,
  UploadReceiptResponse,
  CreateExTransactionParams,
  UpdateExTransactionParams,
} from './expense.js';

// 会計API型 re-export
export type {
  AccountingPagination,
  AccountGroup,
  FinancialStatementType,
  SubAccount,
  Account,
  AccountResponse,
  SubAccountResponse,
  Tax,
  TaxResponse,
  Department,
  DepartmentResponse,
  OfficeType,
  EmployeeCount,
  PlNameValueDisplayOption,
  AccountingPeriod,
  Office as AccountingOffice,
  TaxMethod,
  AccountingMethod,
  RoundingMethod,
  BusinessType,
  TermSetting,
  TermSettingsResponse,
  TradePartner,
  TradePartnersResponse,
  InvoiceKind,
  JournalType,
  EnteredByType,
  JournalLineDetails,
  JournalLine,
  JournalItem,
  GetJournalsResponse,
  CRUDJournalResponse,
  ListJournalsParams,
  ListAccountsParams,
  ListSubAccountsParams,
  ListTaxesParams,
  ListTradePartnersParams,
} from './accounting.js';

// 取引先
export interface Partner {
  id: string;
  name: string;
  name_kana?: string;
  name_suffix?: string;
  code?: string;
  memo?: string;
  departments: PartnerDepartment[];
  created_at: string;
  updated_at: string;
}

export interface PartnerDepartment {
  id: string;
  name: string;
  zip?: string;
  tel?: string;
  prefecture?: string;
  address1?: string;
  address2?: string;
  person_name?: string;
  person_title?: string;
  email?: string;
  cc_emails?: string;
}

// 品目
export interface Item {
  id: string;
  name: string;
  code?: string;
  detail?: string;
  unit?: string;
  price?: MoneyString;
  quantity?: MoneyString;
  is_deduct_withholding_tax?: boolean;
  excise?: string;
  created_at: string;
  updated_at: string;
}

// 明細行
export interface LineItem {
  id?: string;
  name: string;
  code?: string;
  detail?: string;
  unit?: string;
  price: number;
  quantity: number;
  is_deduct_withholding_tax?: boolean;
  excise?: string;
}

// 見積書
export interface Quote {
  id: string;
  pdf_url?: string;
  operator_id?: string;
  department_id?: string;
  partner_id?: string;
  partner_name?: string;
  partner_detail?: string;
  member_id?: string;
  member_name?: string;
  title?: string;
  memo?: string;
  quote_number?: string;
  quote_date?: string;
  expired_date?: string;
  status: QuoteStatus;
  /** 税抜小計。API は数値文字列（例 "700.0"）で返す */
  subtotal_price?: MoneyString;
  /** 消費税額。API は数値文字列で返す */
  excise_price?: MoneyString;
  /** 税込合計。API は数値文字列で返す */
  total_price?: MoneyString;
  items: QuoteItem[];
  created_at: string;
  updated_at: string;
}

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'cancelled';

export interface QuoteItem {
  id?: string;
  name: string;
  code?: string;
  detail?: string;
  unit?: string;
  price: MoneyString;
  quantity: MoneyString;
  is_deduct_withholding_tax?: boolean;
  excise?: string;
}

export interface CreateQuoteParams {
  department_id: string;
  quote_date: string;
  expired_date: string;
  title?: string;
  memo?: string;
  note?: string;
  tag_names?: string[];
  document_name?: string;
  items?: InvoiceTemplateLineItem[];
}

export interface UpdateQuoteParams {
  title?: string;
  memo?: string;
  quote_date?: string;
  expired_date?: string;
  items?: InvoiceTemplateLineItem[];
}

// 納品書
export interface DeliverySlip {
  id: string;
  pdf_url?: string;
  operator_id?: string;
  department_id?: string;
  partner_id?: string;
  partner_name?: string;
  partner_detail?: string;
  title?: string;
  memo?: string;
  delivery_number?: string;
  delivery_date?: string;
  subtotal_price?: MoneyString;
  excise_price?: MoneyString;
  total_price?: MoneyString;
  items: DeliverySlipItem[];
  created_at: string;
  updated_at: string;
}

export interface DeliverySlipItem {
  id?: string;
  name: string;
  code?: string;
  detail?: string;
  unit?: string;
  price: number;
  quantity: number;
  is_deduct_withholding_tax?: boolean;
  excise?: string;
}

export interface CreateDeliverySlipFromQuoteParams {
  quote_id: string;
  delivery_date?: string;
  title?: string;
  memo?: string;
}

// 請求書
export interface Billing {
  id: string;
  pdf_url?: string;
  operator_id?: string;
  department_id?: string;
  partner_id?: string;
  partner_name?: string;
  partner_detail?: string;
  member_id?: string;
  member_name?: string;
  title?: string;
  memo?: string;
  payment_condition?: string;
  billing_number?: string;
  billing_date?: string;
  due_date?: string;
  sales_date?: string;
  payment_status: PaymentStatus;
  /** 税抜小計。API は数値文字列（例 "123456.0"）で返す */
  subtotal_price?: MoneyString;
  /** 消費税額。API は数値文字列で返す */
  excise_price?: MoneyString;
  /** 税込合計。API は数値文字列で返す */
  total_price?: MoneyString;
  items: BillingItem[];
  created_at: string;
  updated_at: string;
}

/**
 * 入金ステータス。
 *
 * 読み取り（GET /billings 等）と書き込み（PUT /billings/:id/payment_status）で
 * 表現が異なる API なので型を分ける。
 *   - 読み取り: 日本語文字列
 *   - 書き込み: "0" | "1" | "2" の数値文字列
 */
export type PaymentStatus = '未設定' | '未入金' | '入金済み' | '未払い' | '振込済み';

export type PaymentStatusCode = '0' | '1' | '2';

/** 期間絞込の対象日付項目（GET /billings の range_key）。from/to と必ずセットで指定する。 */
export type BillingRangeKey =
  | 'billing_date'
  | 'due_date'
  | 'sales_date'
  | 'created_at'
  | 'updated_at';

export interface BillingItem {
  id?: string;
  name: string;
  code?: string;
  detail?: string;
  unit?: string;
  price: MoneyString;
  quantity: MoneyString;
  is_deduct_withholding_tax?: boolean;
  excise?: string;
}

export interface CreateBillingParams {
  department_id?: string;
  partner_id?: string;
  partner_name?: string;
  partner_detail?: string;
  title?: string;
  memo?: string;
  payment_condition?: string;
  billing_date?: string;
  due_date?: string;
  sales_date?: string;
  items: LineItem[];
}

export interface CreateBillingFromQuoteParams {
  quote_id: string;
  billing_date?: string;
  due_date?: string;
  sales_date?: string;
  title?: string;
  memo?: string;
  payment_condition?: string;
}

/**
 * PUT /billings/:id が受け付けるヘッダ項目。
 *
 * ⚠️ items / partner_id はこのエンドポイントの契約に存在しない。
 * 渡しても 200 が返るが無視されるため、明細の差し替えは
 * `replaceBillingItems()`（品目の個別 DELETE + POST）で行う。
 */
export interface UpdateBillingParams {
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
}

export interface UpdatePaymentStatusParams {
  billing_id: string;
  payment_status: PaymentStatusCode;
}

/**
 * POST /billings/:billing_id/items のボディ。
 * item_id を指定しない場合 excise は必須。
 */
export interface AddBillingItemParams {
  item_id?: string;
  name?: string;
  delivery_number?: string;
  delivery_date?: string;
  detail?: string;
  unit?: string;
  price: number;
  quantity: number;
  is_deduct_withholding_tax?: boolean;
  excise?: string;
}

// インボイス制度対応請求書の明細行
export interface InvoiceTemplateLineItem {
  item_id?: string;
  name?: string;
  delivery_number?: string;
  delivery_date?: string;
  detail?: string;
  unit?: string;
  price: number;
  quantity: number;
  is_deduct_withholding_tax?: boolean;
  excise: 'untaxable' | 'non_taxable' | 'tax_exemption' | 'five_percent' | 'eight_percent' | 'eight_percent_as_reduced_tax_rate' | 'ten_percent';
}

// インボイス制度対応請求書作成パラメータ
export interface CreateInvoiceTemplateBillingParams {
  department_id: string;
  billing_date: string;
  title?: string;
  memo?: string;
  payment_condition?: string;
  due_date?: string;
  sales_date?: string;
  billing_number?: string;
  note?: string;
  document_name?: string;
  tag_names?: string[];
  items?: InvoiceTemplateLineItem[];
}


// 検索パラメータ
export interface ListPartnersParams {
  page?: number;
  per_page?: number;
  q?: string;
}

export interface ListItemsParams {
  page?: number;
  per_page?: number;
  q?: string;
}

export interface ListQuotesParams {
  page?: number;
  per_page?: number;
  partner_id?: string;
  status?: QuoteStatus;
  from?: string;
  to?: string;
  q?: string;
}

export interface ListBillingsParams {
  page?: number;
  per_page?: number;
  partner_id?: string;
  /** 書類ステータス（例: 下書き / ロック中 / 未ロック）。入金ステータスではない */
  status?: string;
  document_number?: string;
  partner_name?: string;
  tags?: string;
  range_key?: BillingRangeKey;
  from?: string;
  to?: string;
  q?: string;
}

