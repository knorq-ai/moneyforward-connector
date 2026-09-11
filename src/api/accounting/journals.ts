import { pathParam } from '../path.js';
import { getAccountingClient } from '../client.js';
import type {
  GetJournalsResponse,
  CRUDJournalResponse,
  ListJournalsParams,
  CreateJournalRequest,
  UpdateJournalRequest,
} from '../../types/accounting.js';

export async function listJournals(params?: ListJournalsParams): Promise<GetJournalsResponse> {
  return getAccountingClient().get<GetJournalsResponse>('/api/v3/journals', {
    start_date: params?.start_date,
    end_date: params?.end_date,
    account_id: params?.account_id,
    is_realized: params?.is_realized === undefined ? undefined : String(params.is_realized),
    page: params?.page,
    per_page: params?.per_page,
  });
}

export async function getJournal(journalId: string): Promise<CRUDJournalResponse> {
  return getAccountingClient().get<CRUDJournalResponse>(
    `/api/v3/journals/${pathParam(journalId, 'journal_id')}`,
  );
}

export async function createJournal(body: CreateJournalRequest): Promise<CRUDJournalResponse> {
  return getAccountingClient().post<CRUDJournalResponse>('/api/v3/journals', body);
}

export async function updateJournal(
  journalId: string,
  body: UpdateJournalRequest,
): Promise<CRUDJournalResponse> {
  return getAccountingClient().put<CRUDJournalResponse>(
    `/api/v3/journals/${pathParam(journalId, 'journal_id')}`,
    body,
  );
}

export async function deleteJournal(journalId: string): Promise<void> {
  await getAccountingClient().delete<void>(
    `/api/v3/journals/${pathParam(journalId, 'journal_id')}`,
  );
}
