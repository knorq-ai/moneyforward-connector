import { getAccountingClient } from '../client.js';
import type { TradePartnersResponse, ListTradePartnersParams } from '../../types/accounting.js';

export async function listTradePartners(
  params?: ListTradePartnersParams,
): Promise<TradePartnersResponse> {
  return getAccountingClient().get<TradePartnersResponse>('/api/v3/trade_partners', {
    available: params?.available === undefined ? undefined : String(params.available),
  });
}
