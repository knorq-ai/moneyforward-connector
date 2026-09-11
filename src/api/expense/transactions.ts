import { pathParam } from '../path.js';
import { getExpenseClient } from '../client.js';
import type {
  ExTransaction,
  CreateExTransactionParams,
  UpdateExTransactionParams,
} from '../../types/index.js';

export async function listMyExTransactions(officeId: string, params?: {
  page?: number;
  limit?: number;
  recognized_at_from?: string;
  recognized_at_to?: string;
  is_reported?: boolean;
}): Promise<ExTransaction[]> {
  const query: Record<string, string | number | undefined> = {
    page: params?.page,
    limit: params?.limit,
    'query_object[recognized_at_from]': params?.recognized_at_from,
    'query_object[recognized_at_to]': params?.recognized_at_to,
    'query_object[is_reported]': params?.is_reported !== undefined ? String(params.is_reported) : undefined,
  };
  const result = await getExpenseClient().get<{ ex_transactions?: ExTransaction[] }>(
    `/offices/${pathParam(officeId, 'office_id')}/me/ex_transactions`,
    query
  );
  return result.ex_transactions || [];
}

export async function getExTransaction(officeId: string, transactionId: string): Promise<ExTransaction> {
  return getExpenseClient().get<ExTransaction>(
    `/offices/${pathParam(officeId, 'office_id')}/me/ex_transactions/${pathParam(transactionId, 'transaction_id')}`
  );
}

export async function createExTransaction(params: CreateExTransactionParams): Promise<ExTransaction> {
  const { office_id, ...body } = params;
  return getExpenseClient().post<ExTransaction>(
    `/offices/${pathParam(office_id, 'office_id')}/me/ex_transactions`,
    { ex_transaction: body }
  );
}

export async function updateExTransaction(
  officeId: string,
  transactionId: string,
  params: UpdateExTransactionParams
): Promise<ExTransaction> {
  return getExpenseClient().put<ExTransaction>(
    `/offices/${pathParam(officeId, 'office_id')}/me/ex_transactions/${pathParam(transactionId, 'transaction_id')}`,
    { ex_transaction: params }
  );
}

export async function deleteExTransaction(officeId: string, transactionId: string): Promise<void> {
  await getExpenseClient().delete(`/offices/${pathParam(officeId, 'office_id')}/me/ex_transactions/${pathParam(transactionId, 'transaction_id')}`);
}
