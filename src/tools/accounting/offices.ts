import { z } from 'zod';
import { getCurrentOffice, listTermSettings } from '../../api/accounting/offices.js';

export const accountingOfficeTools = {
  mf_accounting_get_office: {
    description: '現在の事業者情報と会計期間を取得する',
    inputSchema: z.object({}),
    handler: async () => {
      try {
        const o = await getCurrentOffice();

        const periodsText = o.accounting_periods
          .map(
            (p) =>
              `  - ${p.fiscal_year}: ${p.start_date} 〜 ${p.end_date}`,
          )
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `事業者情報\n\n名称: ${o.name}\nコード: ${o.code}\n区分: ${o.type}\n従業員数: ${o.employee_count ?? '-'}\n製造原価科目: ${o.is_manufacturing}\n不動産所得: ${o.is_real_estate ?? '-'}\nPL表示: ${o.pl_name_value_display_option ?? '-'}\n\n会計年度:\n${periodsText}`,
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

  mf_accounting_list_term_settings: {
    description: '会計年度設定一覧を取得する',
    inputSchema: z.object({}),
    handler: async () => {
      try {
        const { term_settings } = await listTermSettings();

        const settingsText = term_settings
          .map(
            (t) =>
              `- ${t.fiscal_year}年度 (${t.start_date} 〜 ${t.end_date})\n  都道府県: ${t.prefecture}\n  事業種別: ${t.business_types.join(', ')}\n  課税形式: ${t.tax_method}\n  経理方式: ${t.accounting_method ?? '-'}\n  端数処理: 売上=${t.sales_rounding_method}, 仕入=${t.purchases_rounding_method}`,
          )
          .join('\n\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `会計年度設定 (${term_settings.length}件)\n\n${settingsText || '設定がない'}`,
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
