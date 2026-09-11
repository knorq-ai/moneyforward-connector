import { pathParam } from '../path.js';
import { getInvoiceClient } from '../client.js';
import type { Partner, PartnerDepartment, ListPartnersParams, ListResponse } from '../../types/index.js';

export async function listPartners(params?: ListPartnersParams): Promise<ListResponse<Partner>> {
  return getInvoiceClient().get<ListResponse<Partner>>('/partners', {
    page: params?.page,
    per_page: params?.per_page,
    q: params?.q,
  });
}

export async function getPartner(partnerId: string): Promise<Partner> {
  return getInvoiceClient().get<Partner>(`/partners/${pathParam(partnerId, 'partner_id')}`);
}

export async function listPartnerDepartments(partnerId: string): Promise<{ data: PartnerDepartment[] }> {
  return getInvoiceClient().get<{ data: PartnerDepartment[] }>(`/partners/${pathParam(partnerId, 'partner_id')}/departments`);
}
