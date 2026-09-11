import { z } from 'zod';
import { uploadReceipt } from '../../api/expense/receipts.js';

export const expenseReceiptTools = {
  mf_expense_upload_receipt: {
    description:
      'レシート画像・PDF をアップロードします。**アップロードだけで経費明細が新規作成される場合があります**（MF 側が OCR して明細を起票する）。添付のみを意図していて別途 mf_expense_create_transaction でも明細を作ると二重計上になるため、結果の「作成された明細数」を必ず確認してください。許可拡張子: jpg / jpeg / png / gif / heic / heif / pdf。認証情報ディレクトリ配下のファイルは拒否します。',
    inputSchema: z.object({
      office_id: z.string().describe('事業者ID'),
      file_path: z
        .string()
        .min(1)
        .describe('アップロードするファイルのパス（画像または PDF。認証情報ディレクトリ配下は不可）'),
    }),
    handler: async (args: { office_id: string; file_path: string }) => {
      try {
        const result = await uploadReceipt(args.office_id, args.file_path);

        const files = result.mf_files?.map(f => f.name).join(', ') || '-';
        const txCount = result.ex_transactions?.length || 0;

        return {
          content: [
            {
              type: 'text' as const,
              text: `レシートをアップロードしました\n\nファイル: ${files}\n作成された明細数: ${txCount}`
                + (txCount > 0
                  ? `\n\n⚠️ このアップロードで経費明細が ${txCount} 件作成されました。`
                    + `別途 mf_expense_create_transaction を実行すると二重計上になります。`
                  : ''),
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
