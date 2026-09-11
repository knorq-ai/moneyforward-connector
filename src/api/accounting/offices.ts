import { getAccountingClient } from '../client.js';
import type { Office, TermSettingsResponse } from '../../types/accounting.js';

export async function getCurrentOffice(): Promise<Office> {
  return getAccountingClient().get<Office>('/api/v3/offices');
}

export async function listTermSettings(): Promise<TermSettingsResponse> {
  return getAccountingClient().get<TermSettingsResponse>('/api/v3/term_settings');
}
