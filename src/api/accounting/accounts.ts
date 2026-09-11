import { getAccountingClient } from '../client.js';
import type {
  AccountResponse,
  SubAccountResponse,
  ListAccountsParams,
  ListSubAccountsParams,
} from '../../types/accounting.js';

export async function listAccounts(params?: ListAccountsParams): Promise<AccountResponse> {
  return getAccountingClient().get<AccountResponse>('/api/v3/accounts', {
    available: params?.available === undefined ? undefined : String(params.available),
  });
}

export async function listSubAccounts(params?: ListSubAccountsParams): Promise<SubAccountResponse> {
  return getAccountingClient().get<SubAccountResponse>('/api/v3/sub_accounts', {
    account_id: params?.account_id,
  });
}
