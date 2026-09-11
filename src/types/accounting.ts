// MoneyForward クラウド会計 API v3 型定義
// 仕様: https://developers.api-accounting.moneyforward.com/v3/openapi.yaml
//
// 注: yaml で nullable: true のフィールドは `string | null` で表現する。
// optional のみ (`?: string`) だと null と undefined を区別できないため。

// ===== 共通 =====

export interface AccountingPagination {
  total_count: number;
  total_pages: number;
}

// ===== Accounts / SubAccounts =====

export type AccountGroup = 'NONE' | 'ASSET' | 'LIABILITY' | 'CAPITAL' | 'REVENUE' | 'EXPENSE';

export type FinancialStatementType =
  | 'BALANCE_SHEET'
  | 'PROFIT_LOSS'
  | 'COST_REPORT'
  | 'REAL_ESTATE'
  | 'UNKNOWN';

export interface SubAccount {
  account_id: string;
  id: string;
  name: string;
  search_key: string | null;
  tax_id: string;
}

export interface Account {
  id: string;
  name: string;
  available: boolean;
  tax_id: string;
  search_key: string | null;
  sub_accounts: SubAccount[];
  account_group: AccountGroup;
  category: string;
  financial_statement_type: FinancialStatementType;
}

export interface AccountResponse {
  accounts: Account[];
}

export interface SubAccountResponse {
  sub_accounts: SubAccount[];
}

// ===== Taxes =====

export interface Tax {
  id: string;
  name: string;
  abbreviation: string;
  tax_rate: number | null;
  search_key: string | null;
  available: boolean;
}

export interface TaxResponse {
  taxes: Tax[];
}

// ===== Departments =====

export interface Department {
  id: string;
  name: string;
  parent_id: string | null;
  search_key: string | null;
}

export interface DepartmentResponse {
  departments: Department[];
}

// ===== Office / TermSettings =====

export type OfficeType = 'INDIVIDUAL' | 'CORPORATE';

export type EmployeeCount =
  | 'NOT_SELECTED'
  | 'OWNER_ONLY'
  | 'RANGE_1_5'
  | 'RANGE_6_10'
  | 'RANGE_11_30'
  | 'RANGE_31_50'
  | 'RANGE_51_100'
  | 'RANGE_101_OR_MORE';

export type PlNameValueDisplayOption = 'SWITCH_NAME_AND_VALUE' | 'SWITCH_NAME' | 'SWITCH_VALUE';

export interface AccountingPeriod {
  start_date: string;
  end_date: string;
  fiscal_year: number;
}

export interface Office {
  name: string;
  code: string;
  type: OfficeType;
  employee_count?: EmployeeCount | null;
  is_real_estate?: boolean | null;
  is_manufacturing: boolean;
  pl_name_value_display_option?: PlNameValueDisplayOption | null;
  accounting_periods: AccountingPeriod[];
}

export type TaxMethod = 'FREE' | 'SIMPLE' | 'PROPORTIONAL_ALLOCATION' | 'INDIVIDUAL_ALLOCATION';
export type AccountingMethod = 'TAX_INCLUDED' | 'TAX_EXCLUDED_SEPARATE' | 'TAX_EXCLUDED_INCLUDED';
export type RoundingMethod = 'ROUND_DOWN' | 'ROUND_UP' | 'ROUND_OFF';
export type BusinessType =
  | 'MANUFACTURING'
  | 'EDUCATION'
  | 'MEDICAL_WELFARE'
  | 'INFORMATION_COMMUNICATION'
  | 'FOOD_SERVICE'
  | 'TRANSPORTATION'
  | 'WHOLESALE'
  | 'RETAIL'
  | 'FINANCE_INSURANCE'
  | 'REAL_ESTATE'
  | 'SERVICES'
  | 'OTHER'
  | 'CONSTRUCTION';

export interface TermSetting {
  start_date: string;
  end_date: string;
  fiscal_year: number;
  prefecture: string;
  business_types: BusinessType[];
  tax_method: TaxMethod;
  accounting_method?: AccountingMethod | null;
  sales_rounding_method: RoundingMethod;
  purchases_rounding_method: RoundingMethod;
}

export interface TermSettingsResponse {
  term_settings: TermSetting[];
}

// ===== Trade Partners =====

export interface TradePartner {
  name: string;
  available: boolean;
  code: string;
  invoice_registration_number: string;
  corporate_number: string;
  search_key: string;
}

export interface TradePartnersResponse {
  trade_partners: TradePartner[];
}

// ===== Journals =====

export type InvoiceKind =
  | 'INVOICE_KIND_NONE'
  | 'INVOICE_KIND_NOT_TARGET'
  | 'INVOICE_KIND_QUALIFIED'
  | 'INVOICE_KIND_UNQUALIFIED_80'
  | 'INVOICE_KIND_UNQUALIFIED_50'
  | 'INVOICE_KIND_UNQUALIFIED';

export type JournalType = 'journal_entry' | 'adjusting_entry';

export type EnteredByType =
  | 'JOURNAL_TYPE_NONE'
  | 'JOURNAL_TYPE_NORMAL'
  | 'JOURNAL_TYPE_OPENING'
  | 'JOURNAL_TYPE_HOME_DEVOTE'
  | 'JOURNAL_TYPE_DEPRECIATION'
  | 'JOURNAL_TYPE_BILLING'
  | 'JOURNAL_TYPE_PAYROLL'
  | 'JOURNAL_TYPE_IMPORT'
  | 'JOURNAL_TYPE_EXPENSE'
  | 'JOURNAL_TYPE_DEBT'
  | 'JOURNAL_TYPE_STREAMED'
  | 'JOURNAL_TYPE_MOBILE_APP'
  | 'JOURNAL_TYPE_ME'
  | 'JOURNAL_TYPE_AI_OCR'
  | 'JOURNAL_TYPE_E_INVOICE'
  | 'JOURNAL_TYPE_EXTERNAL'
  | 'JOURNAL_TYPE_DATA_LINKAGE';

export interface JournalLineDetails {
  value: number;
  tax_value: number | null;
  account_id: string;
  account_name: string;
  sub_account_id: string | null;
  sub_account_name: string | null;
  tax_id: string | null;
  tax_name: string | null;
  tax_long_name: string | null;
  department_id: string | null;
  department_name: string | null;
  trade_partner_name: string | null;
  trade_partner_code: string | null;
  invoice_kind: InvoiceKind | null;
}

export interface JournalLine {
  remark: string | null;
  creditor: JournalLineDetails;
  debitor: JournalLineDetails;
}

export interface JournalItem {
  id: string;
  number: number;
  term_period: number;
  transaction_date: string;
  is_realized: boolean;
  journal_type: JournalType;
  entered_by: EnteredByType;
  create_time: string;
  update_time: string;
  branches: JournalLine[];
  tags: string[];
  memo: string | null;
  voucher_file_ids: string[];
}

export interface GetJournalsResponse {
  metadata: AccountingPagination;
  journals: JournalItem[];
}

export interface CRUDJournalResponse {
  journal: JournalItem;
}

// ===== Journal create/update request =====
//
// POST /api/v3/journals および PUT /api/v3/journals/{id} のリクエストボディ。
// レスポンス側 (JournalLineDetails) と異なり、name 系フィールドは API が ID から
// 解決するため必須ではない。クライアント側は ID（account_id, tax_id, ...）と value だけ
// 渡せば足りる。nullable optional は `string | null` を維持する。

export interface JournalLineDetailsInput {
  value: number;
  tax_value?: number | null;
  account_id: string;
  account_name?: string;
  sub_account_id?: string | null;
  sub_account_name?: string | null;
  tax_id?: string | null;
  tax_name?: string | null;
  tax_long_name?: string | null;
  department_id?: string | null;
  department_name?: string | null;
  trade_partner_name?: string | null;
  trade_partner_code?: string | null;
  invoice_kind?: InvoiceKind | null;
}

export interface JournalLineInput {
  remark?: string | null;
  debitor: JournalLineDetailsInput;
  creditor: JournalLineDetailsInput;
}

export interface CreateJournalRequest {
  journal: {
    transaction_date: string;
    journal_type: JournalType;
    memo?: string;
    tags?: string[];
    branches: JournalLineInput[];
  };
}

export type UpdateJournalRequest = CreateJournalRequest;

// ===== List query params =====

export interface ListJournalsParams {
  start_date?: string;
  end_date?: string;
  account_id?: string;
  is_realized?: boolean;
  page?: number;
  per_page?: number;
}

export interface ListAccountsParams {
  available?: boolean;
}

export interface ListSubAccountsParams {
  account_id?: string;
}

export interface ListTaxesParams {
  available?: boolean;
}

export interface ListTradePartnersParams {
  available?: boolean;
}
