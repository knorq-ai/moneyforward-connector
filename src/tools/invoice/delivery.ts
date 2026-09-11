import { z } from 'zod';

export const deliveryTools = {
  mf_create_delivery_slip: {
    description: '【v3 API未サポート】見積書から納品書を作成します。※現在v3 APIでは納品書作成エンドポイントが提供されていないため、このツールは機能しません。納品書はマネーフォワードのWebUIから作成してください。',
    inputSchema: z.object({
      quote_id: z.string().describe('元となる見積書のID'),
      delivery_date: z.string().optional().describe('納品日（YYYY-MM-DD）'),
      title: z.string().optional().describe('納品書タイトル'),
      memo: z.string().optional().describe('メモ'),
    }),
    handler: async (_args: {
      quote_id: string;
      delivery_date?: string;
      title?: string;
      memo?: string;
    }) => {
      return {
        content: [
          {
            type: 'text' as const,
            text: `v3 API未サポート

MoneyForward クラウド請求書 API v3 では、納品書作成エンドポイント（/delivery_slips/from_quote）が提供されていません。

納品書が必要な場合は、マネーフォワードのWebUIから手動で作成してください:
https://invoice.moneyforward.com/

【代替手順】
1. マネーフォワードクラウド請求書にログイン
2. 見積書一覧から対象の見積書を選択
3. 「納品書を作成」ボタンをクリック
4. 必要事項を入力して保存`,
          },
        ],
        // このツールは構造上必ず失敗する（v3 API にエンドポイントが無い）。
        // 成功として返すと、呼び出し側は納品書が出来たと解釈する。
        isError: true,
      };
    },
  },
};
