import { pathParam } from '../path.js';
import { getInvoiceClient } from '../client.js';
import type { Item, ListItemsParams, ListResponse } from '../../types/index.js';

export async function listItems(params?: ListItemsParams): Promise<ListResponse<Item>> {
  return getInvoiceClient().get<ListResponse<Item>>('/items', {
    page: params?.page,
    per_page: params?.per_page,
    q: params?.q,
  });
}

export async function getItem(itemId: string): Promise<Item> {
  return getInvoiceClient().get<Item>(`/items/${pathParam(itemId, 'item_id')}`);
}
