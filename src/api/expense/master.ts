import { pathParam } from '../path.js';
import { getExpenseClient } from '../client.js';
import type { ExItem, Dept, Project } from '../../types/index.js';

export async function listExItems(officeId: string): Promise<ExItem[]> {
  const result = await getExpenseClient().get<{ ex_items?: ExItem[] }>(
    `/offices/${pathParam(officeId, 'office_id')}/ex_items`
  );
  return result.ex_items || [];
}

export async function listDepts(officeId: string): Promise<Dept[]> {
  const result = await getExpenseClient().get<{ depts?: Dept[] }>(
    `/offices/${pathParam(officeId, 'office_id')}/depts`
  );
  return result.depts || [];
}

export async function listProjects(officeId: string): Promise<Project[]> {
  const result = await getExpenseClient().get<{ projects?: Project[] }>(
    `/offices/${pathParam(officeId, 'office_id')}/projects`
  );
  return result.projects || [];
}
