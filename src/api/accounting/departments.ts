import { getAccountingClient } from '../client.js';
import type { DepartmentResponse } from '../../types/accounting.js';

export async function listDepartments(): Promise<DepartmentResponse> {
  return getAccountingClient().get<DepartmentResponse>('/api/v3/departments');
}
