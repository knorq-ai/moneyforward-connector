// 共通型定義（複数サービスで共有）

export interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  expires_at?: number;
  scope: string;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface Pagination {
  total_count: number;
  total_pages: number;
  current_page: number;
  per_page: number;
}

export interface ListResponse<T> {
  data: T[];
  pagination: Pagination;
}

/**
 * 単一のエラー要素。MF 各 API でエラー配列の要素として返ってくるフォーマット。
 */
export interface ApiErrorItem {
  code?: string;
  message?: string;
}

/**
 * MF API のエラーレスポンスは複数の表現を許容する:
 *   - 旧型: `{ code, message, errors?: { field: [msg] } }`
 *   - 新型（会計 API など）: `{ errors: [{ code, message }, ...] }`
 * 両方を許容できる型として表現する。
 */
export interface ApiError {
  code?: string;
  message?: string;
  errors?: Record<string, string[]> | ApiErrorItem[];
}
