import { getExpenseClient } from '../client.js';
import type { Office } from '../../types/index.js';

export async function listOffices(): Promise<Office[]> {
  const result = await getExpenseClient().get<{ offices?: Office[] }>('/offices');
  return result.offices || [];
}
