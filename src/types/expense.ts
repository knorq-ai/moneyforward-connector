// MoneyForward クラウド経費 API 型定義
// Based on Swagger definition + actual API response

// 事業者
export interface Office {
  id: string;
  name: string;
  code?: string;
}

// 経費明細
export interface ExTransaction {
  id: string;
  number: number;
  office_member_id?: string;
  ex_item_id?: string;
  dr_excise_id?: string;
  cr_item_id?: string;
  cr_sub_item_id?: string;
  dept_id?: string | null;
  project_id?: string | null;
  project_code_id?: string | null;
  value: number;
  jpyrate?: number;
  currency?: string;
  recognized_at?: string;
  remark?: string;
  memo?: string;
  report_number?: number | null;
  automatic_status?: string;
  error_message?: string | null;
  warning_message?: string | null;
  receipt_type?: string | null;
  created_at?: string;
  updated_at?: string;
  // Nested objects
  office_member?: { id: string; name: string; number?: string };
  ex_item?: { id: string; name: string; code?: string | null; item?: { id: string; name: string } };
  dr_excise?: { id: string; long_name: string; code?: string | null; rate?: number | null };
  cr_item?: { id: string; name: string; code?: string };
  cr_sub_item?: { id: string; name: string; code?: string | null } | null;
  dept?: { id: string; name: string; code?: string } | null;
  project?: { id: string; name: string; code?: string } | null;
  ex_report?: { id: string; title?: string; number?: number; status?: string } | null;
  mf_file?: { id: string; name: string; byte_size?: number; content_type?: string } | null;
}

// 経費申請（レポート）
export interface ExReport {
  id: string;
  office_member_id?: string;
  title?: string;
  number?: number;
  status?: string;
  total_value?: number;
  submitted_at?: string | null;
  approved_at?: string | null;
  created_at?: string;
  updated_at?: string;
  ex_transactions?: ExTransaction[];
  office_member?: { id: string; name: string };
  ex_report_approvals?: ExReportApproval[];
}

export interface ExReportApproval {
  step: number;
  is_active: boolean;
  approved_at?: string | null;
  approve_office_member?: { id: string; name: string };
}

// 経費科目
export interface ExItem {
  id: string;
  name: string;
  code?: string | null;
  is_active?: boolean;
  item?: { id: string; name: string; code?: string | null };
  sub_item?: { id: string; name: string; code?: string | null } | null;
  default_dr_excise?: { id: string; long_name: string } | null;
}

// 税区分
export interface Excise {
  id: string;
  long_name?: string;
  name?: string;
  code?: string | null;
  rate?: number | null;
}

// 部門
export interface Dept {
  id: string;
  name: string;
  code?: string;
  is_active?: boolean;
  parent_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

// プロジェクト
export interface Project {
  id: string;
  name: string;
  code?: string;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

// レシートアップロードレスポンス
export interface UploadReceiptResponse {
  mf_files?: { id: string; name: string; byte_size?: number }[];
  ex_transactions?: ExTransaction[];
}

// 経費明細作成パラメータ
export interface CreateExTransactionParams {
  office_id: string;
  value: number;
  recognized_at: string;
  ex_item_id?: string;
  dr_excise_id?: string;
  dept_id?: string;
  project_id?: string;
  remark?: string;
  memo?: string;
}

// 経費明細更新パラメータ
export interface UpdateExTransactionParams {
  value?: number;
  recognized_at?: string;
  ex_item_id?: string;
  dr_excise_id?: string;
  dept_id?: string;
  project_id?: string;
  remark?: string;
  memo?: string;
}
