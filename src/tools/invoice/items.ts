import { z } from 'zod';
import { listItems, getItem } from '../../api/invoice/items.js';
import { formatMoney, formatQuantity } from './format.js';

export const itemTools = {
  mf_list_items: {
    description: '品目一覧を取得します。検索キーワードで絞り込み可能です。',
    inputSchema: z.object({
      page: z.number().optional().describe('ページ番号（デフォルト: 1）'),
      per_page: z.number().optional().describe('1ページあたりの件数（デフォルト: 25）'),
      q: z.string().optional().describe('検索キーワード（品目名で検索）'),
    }),
    handler: async (args: { page?: number; per_page?: number; q?: string }) => {
      try {
        const result = await listItems(args);

        const itemsText = result.data
          .map(
            (i) =>
              `- ${i.name}${i.code ? ` (${i.code})` : ''}\n  ID: ${i.id}\n  単価: ${formatMoney(i.price)}  数量: ${formatQuantity(i.quantity)}  単位: ${i.unit || '-'}`
          )
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `品目一覧 (${result.pagination.current_page}/${result.pagination.total_pages}ページ, 全${result.pagination.total_count}件)\n\n${itemsText || '品目が見つかりません'}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `エラー: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  },

  mf_get_item: {
    description: '品目の詳細情報を取得します',
    inputSchema: z.object({
      item_id: z.string().describe('品目ID'),
    }),
    handler: async (args: { item_id: string }) => {
      try {
        const item = await getItem(args.item_id);

        return {
          content: [
            {
              type: 'text' as const,
              text: `品目詳細\n\n名前: ${item.name}\nコード: ${item.code || '-'}\nID: ${item.id}\n詳細: ${item.detail || '-'}\n単価: ${formatMoney(item.price)}\n数量: ${formatQuantity(item.quantity)}\n単位: ${item.unit || '-'}\n源泉徴収: ${item.is_deduct_withholding_tax ? '対象' : '対象外'}\n消費税: ${item.excise || '-'}\n\n作成日: ${item.created_at}\n更新日: ${item.updated_at}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `エラー: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  },
};
