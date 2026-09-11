import { z } from 'zod';
import { listPartners, getPartner } from '../../api/invoice/partners.js';

export const partnerTools = {
  mf_list_partners: {
    description: '取引先一覧を取得します。検索キーワードで絞り込み可能です。',
    inputSchema: z.object({
      page: z.number().optional().describe('ページ番号（デフォルト: 1）'),
      per_page: z.number().optional().describe('1ページあたりの件数（デフォルト: 25）'),
      q: z.string().optional().describe('検索キーワード（取引先名で検索）'),
    }),
    handler: async (args: { page?: number; per_page?: number; q?: string }) => {
      try {
        const result = await listPartners(args);

        const partnersText = result.data
          .map(
            (p) =>
              `- ${p.name}${p.code ? ` (${p.code})` : ''}\n  ID: ${p.id}`
          )
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `取引先一覧 (${result.pagination.current_page}/${result.pagination.total_pages}ページ, 全${result.pagination.total_count}件)\n\n${partnersText || '取引先が見つかりません'}`,
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

  mf_get_partner: {
    description: '取引先の詳細情報を取得します',
    inputSchema: z.object({
      partner_id: z.string().describe('取引先ID'),
    }),
    handler: async (args: { partner_id: string }) => {
      try {
        const partner = await getPartner(args.partner_id);

        const deptInfo =
          partner.departments.length > 0
            ? partner.departments
                .map(
                  (d) =>
                    `  部門: ${d.name}\n    担当者: ${d.person_name || '-'}${d.person_title ? ` (${d.person_title})` : ''}\n    住所: ${d.zip ? `〒${d.zip} ` : ''}${d.prefecture || ''}${d.address1 || ''}${d.address2 || ''}\n    TEL: ${d.tel || '-'}\n    Email: ${d.email || '-'}`
                )
                .join('\n')
            : '  部門情報なし';

        return {
          content: [
            {
              type: 'text' as const,
              text: `取引先詳細\n\n名前: ${partner.name}${partner.name_kana ? ` (${partner.name_kana})` : ''}\nコード: ${partner.code || '-'}\nID: ${partner.id}\nメモ: ${partner.memo || '-'}\n\n${deptInfo}\n\n作成日: ${partner.created_at}\n更新日: ${partner.updated_at}`,
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
