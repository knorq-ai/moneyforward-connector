import { pathParam } from '../path.js';
import { getInvoiceClient } from '../client.js';
import type {
  Quote,
  Billing,
  ListQuotesParams,
  ListResponse,
  CreateQuoteParams,
  UpdateQuoteParams,
} from '../../types/index.js';

export async function listQuotes(params?: ListQuotesParams): Promise<ListResponse<Quote>> {
  return getInvoiceClient().get<ListResponse<Quote>>('/quotes', {
    page: params?.page,
    per_page: params?.per_page,
    partner_id: params?.partner_id,
    status: params?.status,
    from: params?.from,
    to: params?.to,
    q: params?.q,
  });
}

export async function getQuote(quoteId: string): Promise<Quote> {
  return getInvoiceClient().get<Quote>(`/quotes/${pathParam(quoteId, 'quote_id')}`);
}

export async function createQuote(params: CreateQuoteParams): Promise<Quote> {
  return getInvoiceClient().post<Quote>('/quotes', params);
}

export async function updateQuote(quoteId: string, params: UpdateQuoteParams): Promise<Quote> {
  return getInvoiceClient().put<Quote>(`/quotes/${pathParam(quoteId, 'quote_id')}`, params);
}

export async function downloadQuotePdf(quoteId: string): Promise<{ pdf_url: string }> {
  const quote = await getQuote(quoteId);
  if (!quote.pdf_url) {
    throw new Error('PDF URL is not available for this quote');
  }
  return { pdf_url: quote.pdf_url };
}

// 見積書を請求書に変換
export async function convertQuoteToBilling(quoteId: string): Promise<Billing> {
  return getInvoiceClient().post<Billing>(`/quotes/${pathParam(quoteId, 'quote_id')}/convert_to_billing`, {});
}
