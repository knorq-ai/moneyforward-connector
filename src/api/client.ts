import { OAuthManager } from '../auth/oauth.js';
import { getOAuthManager } from '../auth/registry.js';
import { getServiceConfig, type ServiceName } from '../config.js';
import { rateLimiter } from './rate-limiter.js';
import type { ApiError, ApiErrorItem } from '../types/index.js';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  params?: Record<string, string | number | undefined>;
}

/**
 * MF API のエラーボディを人間可読な 1 行に整形する。
 *
 * サポート形式:
 *   - `{ errors: [{ code, message }, ...] }` （会計 API など）
 *   - `{ code, message }` （単発、旧 invoice/expense）
 *   - `{ code, message, errors: { field: [msg, ...] } }` （バリデーション）
 * いずれにも該当しない場合は JSON 化したものをそのまま返す。
 */
export function formatApiErrorBody(body: ApiError): string {
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    return (body.errors as ApiErrorItem[])
      .map((e) => {
        const code = e.code ?? 'unknown';
        const msg = e.message ?? '';
        return `[${code}] ${msg}`;
      })
      .join('; ');
  }

  if (body.errors && typeof body.errors === 'object' && !Array.isArray(body.errors)) {
    const fieldErrors = Object.entries(body.errors)
      .map(([field, msgs]) => `${field}: ${(Array.isArray(msgs) ? msgs : [msgs]).join(', ')}`)
      .join('; ');
    const head = body.message ?? body.code ?? 'validation failed';
    return fieldErrors ? `${head} (${fieldErrors})` : head;
  }

  if (body.message || body.code) {
    return [body.code, body.message].filter(Boolean).join(': ');
  }

  return JSON.stringify(body);
}

/** 429 リトライの上限。無制限に再帰すると MCP 呼び出しが終わらなくなる。 */
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RETRY_AFTER_SECONDS = 60;
/** 1 リクエストが 429 のために待つ合計時間の上限。回数上限だけでは 3 分待てる。 */
const MAX_RATE_LIMIT_WAIT_MS = 30_000;

function rateLimitError(): Error {
  return new Error(
    'API request failed: 429 Too Many Requests'
      + `（リトライ上限 ${MAX_RATE_LIMIT_RETRIES} 回または合計待機上限 `
      + `${MAX_RATE_LIMIT_WAIT_MS / 1000} 秒に達しました。`
      + 'しばらく待ってから再度お試しください）'
  );
}

/**
 * `Retry-After` を秒数に直す。秒数形式と HTTP-date 形式の両方を受ける。
 * 解釈できない値・過大な値は安全側の既定にクランプする。
 */
export function parseRetryAfterSeconds(raw: string | null): number {
  if (!raw) return 1;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed), MAX_RETRY_AFTER_SECONDS);
  }
  const when = Date.parse(trimmed);
  if (!Number.isNaN(when)) {
    const seconds = Math.ceil((when - Date.now()) / 1000);
    if (seconds <= 0) return 1;
    return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
  }
  return 1;
}

export class ApiClient {
  private baseUrl: string;
  private oauthManager: OAuthManager;

  constructor(baseUrl: string, oauthManager: OAuthManager) {
    this.baseUrl = baseUrl;
    this.oauthManager = oauthManager;
  }

  /**
   * 429 のリトライ待ちを行う。合計待機時間が上限に達したら、次のリクエストを
   * 投げずに打ち切る。返り値は累積待機時間。
   */
  private async waitForRateLimitRetry(retryAfterSeconds: number, waitedMs: number): Promise<number> {
    const remainingMs = MAX_RATE_LIMIT_WAIT_MS - waitedMs;
    if (remainingMs <= 0) throw rateLimitError();

    const delayMs = Math.min(retryAfterSeconds * 1000, remainingMs);
    await new Promise(resolve => setTimeout(resolve, delayMs));

    // 枠を使い切ったなら、もう 1 回投げずに案内を返す
    if (delayMs >= remainingMs) throw rateLimitError();
    return waitedMs + delayMs;
  }

  private async request<T>(endpoint: string, options: RequestOptions = {}, attempt = 0, waitedMs = 0): Promise<T> {
    await rateLimiter.waitForSlot();

    const accessToken = await this.oauthManager.getAccessToken();

    const url = new URL(`${this.baseUrl}${endpoint}`);

    // Add query parameters
    if (options.params) {
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    };

    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url.toString(), {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        // Rate limit exceeded - wait and retry (回数上限つき)
        const waited = await this.waitForRateLimitRetry(
          parseRetryAfterSeconds(response.headers.get('Retry-After')),
          waitedMs,
        );
        return this.request<T>(endpoint, options, attempt + 1, waited);
      }
      if (response.status === 429) {
        throw rateLimitError();
      }

      let errorMessage = `API request failed: ${response.status} ${response.statusText}`;
      try {
        const errorBody = await response.json() as ApiError;
        errorMessage = `${errorMessage}: ${formatApiErrorBody(errorBody)}`;
      } catch {
        // ignore JSON parse error
      }
      throw new Error(errorMessage);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return {} as T;
    }

    // 201 Created などボディを返さない成功レスポンスがある
    // （例: POST /billings/:id/items）。空ボディを JSON.parse すると落ちる。
    const text = await response.text();
    if (text.trim() === '') {
      return {} as T;
    }

    return JSON.parse(text) as T;
  }

  async get<T>(endpoint: string, params?: Record<string, string | number | undefined>): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET', params });
  }

  async post<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, { method: 'POST', body });
  }

  async put<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, { method: 'PUT', body });
  }

  async patch<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, { method: 'PATCH', body });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }

  async postFormData<T>(endpoint: string, formData: FormData, attempt = 0, waitedMs = 0): Promise<T> {
    await rateLimiter.waitForSlot();

    const accessToken = await this.oauthManager.getAccessToken();
    const url = new URL(`${this.baseUrl}${endpoint}`);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
      body: formData,
    });

    if (!response.ok) {
      if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        const waited = await this.waitForRateLimitRetry(
          parseRetryAfterSeconds(response.headers.get('Retry-After')),
          waitedMs,
        );
        return this.postFormData<T>(endpoint, formData, attempt + 1, waited);
      }
      if (response.status === 429) {
        throw rateLimitError();
      }
      let errorMessage = `API request failed: ${response.status} ${response.statusText}`;
      try {
        const errorBody = await response.json() as ApiError;
        errorMessage = `${errorMessage}: ${formatApiErrorBody(errorBody)}`;
      } catch {
        // ignore
      }
      throw new Error(errorMessage);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return await response.json() as T;
  }
}

// Factory functions for creating service-specific API clients
const clients = new Map<ServiceName, ApiClient>();

export function getApiClient(service: ServiceName): ApiClient {
  let client = clients.get(service);
  if (!client) {
    const config = getServiceConfig(service);
    const oauthManager = getOAuthManager(service);
    client = new ApiClient(config.api.baseUrl, oauthManager);
    clients.set(service, client);
  }
  return client;
}

// Convenience accessors
export function getInvoiceClient(): ApiClient {
  return getApiClient('invoice');
}

export function getExpenseClient(): ApiClient {
  return getApiClient('expense');
}

export function getAccountingClient(): ApiClient {
  return getApiClient('accounting');
}
