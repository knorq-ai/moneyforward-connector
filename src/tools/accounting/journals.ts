import { z } from 'zod';
import {
  listJournals,
  getJournal,
  createJournal,
  updateJournal,
  deleteJournal,
} from '../../api/accounting/journals.js';
import type {
  JournalLineDetails,
  CreateJournalRequest,
  JournalLineInput,
  JournalLineDetailsInput,
} from '../../types/accounting.js';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const dateSchema = z.string().regex(dateRegex, 'YYYY-MM-DD 形式で指定する');

const invoiceKindEnum = z.enum([
  'INVOICE_KIND_NONE',
  'INVOICE_KIND_NOT_TARGET',
  'INVOICE_KIND_QUALIFIED',
  'INVOICE_KIND_UNQUALIFIED_80',
  'INVOICE_KIND_UNQUALIFIED_50',
  'INVOICE_KIND_UNQUALIFIED',
]);

const journalLineDetailsInputSchema = z.object({
  value: z.number().int().describe('税込金額（必須）'),
  tax_value: z.number().int().nullable().optional().describe('うち消費税額'),
  account_id: z.string().describe('勘定科目ID（必須）'),
  account_name: z.string().optional().describe('勘定科目名（任意、API は ID で解決）'),
  sub_account_id: z.string().nullable().optional().describe('補助科目ID'),
  sub_account_name: z.string().nullable().optional().describe('補助科目名'),
  tax_id: z.string().nullable().optional().describe('税区分ID'),
  tax_name: z.string().nullable().optional().describe('税区分名'),
  tax_long_name: z.string().nullable().optional().describe('税区分の正式名称'),
  department_id: z.string().nullable().optional().describe('部門ID'),
  department_name: z.string().nullable().optional().describe('部門名'),
  trade_partner_code: z.string().nullable().optional().describe('取引先コード'),
  trade_partner_name: z.string().nullable().optional().describe('取引先名'),
  invoice_kind: invoiceKindEnum.nullable().optional().describe('インボイス区分'),
});

const journalLineInputSchema = z.object({
  remark: z.string().nullable().optional().describe('摘要（行単位）'),
  debitor: journalLineDetailsInputSchema.describe('借方'),
  creditor: journalLineDetailsInputSchema.describe('貸方'),
});

const journalTypeEnum = z.enum(['journal_entry', 'adjusting_entry']);

/**
 * 仕訳の借貸合計を検証する。
 *
 * - 各 branch（複合仕訳の 1 行）は 1 借方 / 1 貸方の対なので、`debitor.value === creditor.value`
 *   を強制する。違反する組はメッセージに列挙する。
 * - 全 branch の借方合計 と 貸方合計 が一致することも防御的に検証する（branch 単位で
 *   揃っていれば自動的に一致するが、将来 branch 構造が変わった場合の保険）。
 * - 違反があれば例外を投げる。
 */
function validateJournalBalance(branches: JournalLineInput[]): void {
  if (branches.length < 1) {
    throw new Error('branches に最低 1 件の借貸ペアが必要');
  }

  const mismatched: string[] = [];
  let debitTotal = 0;
  let creditTotal = 0;
  branches.forEach((b, idx) => {
    const d = b.debitor.value;
    const c = b.creditor.value;
    debitTotal += d;
    creditTotal += c;
    if (d !== c) {
      mismatched.push(`branches[${idx}]: debitor.value=${d} != creditor.value=${c}`);
    }
  });

  if (mismatched.length > 0) {
    throw new Error(`借貸不一致: ${mismatched.join('; ')}`);
  }
  if (debitTotal !== creditTotal) {
    throw new Error(`総借方=${debitTotal} と総貸方=${creditTotal} が不一致`);
  }
}

function buildCreateJournalBody(args: {
  transaction_date: string;
  journal_type: 'journal_entry' | 'adjusting_entry';
  memo?: string;
  tags?: string[];
  branches: JournalLineInput[];
}): CreateJournalRequest {
  const journal: CreateJournalRequest['journal'] = {
    transaction_date: args.transaction_date,
    journal_type: args.journal_type,
    branches: args.branches,
  };
  if (args.memo !== undefined) journal.memo = args.memo;
  if (args.tags !== undefined) journal.tags = args.tags;
  return { journal };
}

function formatJournalDetailsInput(d: JournalLineDetailsInput): string {
  const parts = [
    `account_id=${d.account_id}`,
    d.sub_account_id ? `sub_account_id=${d.sub_account_id}` : null,
    `value=${d.value}`,
    d.tax_value !== null && d.tax_value !== undefined ? `tax_value=${d.tax_value}` : null,
    d.tax_id ? `tax_id=${d.tax_id}` : null,
    d.department_id ? `department_id=${d.department_id}` : null,
    d.trade_partner_code ? `trade_partner_code=${d.trade_partner_code}` : null,
    d.invoice_kind ? `invoice_kind=${d.invoice_kind}` : null,
  ].filter(Boolean);
  return parts.join(', ');
}

function formatResultJournal(j: import('../../types/accounting.js').JournalItem): string {
  const branchesText = j.branches
    .map((b, i) => {
      const debit = formatJournalDetails(b.debitor);
      const credit = formatJournalDetails(b.creditor);
      const remark = b.remark ? `\n      remark: ${b.remark}` : '';
      return `  [${i + 1}] 借方 { ${debit} }\n      貸方 { ${credit} }${remark}`;
    })
    .join('\n');
  const tagsText = j.tags.length ? `\nタグ: ${j.tags.join(', ')}` : '';
  const memoText = j.memo ? `\nメモ: ${j.memo}` : '';
  return `ID: ${j.id}\n番号: ${j.number}\n取引日: ${j.transaction_date}\n仕訳区分: ${j.journal_type}${memoText}${tagsText}\n\n${branchesText}`;
}

function formatJournalDetails(d: JournalLineDetails): string {
  const parts = [
    `account=${d.account_name}`,
    d.sub_account_name ? `sub=${d.sub_account_name}` : null,
    `value=${d.value}`,
    d.tax_value !== null && d.tax_value !== undefined ? `tax_value=${d.tax_value}` : null,
    d.tax_name ? `tax=${d.tax_name}` : null,
    d.department_name ? `dept=${d.department_name}` : null,
    d.trade_partner_code || d.trade_partner_name
      ? `partner=${d.trade_partner_name ?? ''}(${d.trade_partner_code ?? ''})`
      : null,
    d.invoice_kind ? `invoice_kind=${d.invoice_kind}` : null,
  ].filter(Boolean);
  return parts.join(', ');
}

export const accountingJournalTools = {
  mf_accounting_list_journals: {
    description:
      '会計仕訳一覧を取得する。start_date または end_date のいずれかを指定する必要がある（同一会計期間内）。',
    inputSchema: z.object({
      start_date: dateSchema.optional().describe('対象期間の開始日（取引日基準）'),
      end_date: dateSchema.optional().describe('対象期間の終了日（取引日基準）'),
      account_id: z.string().optional().describe('勘定科目ID（借方/貸方のいずれかに含む仕訳を絞り込む）'),
      is_realized: z.boolean().optional().describe('未実現仕訳のフラグ。未指定なら全件返却'),
      page: z.number().int().min(1).optional().describe('ページ番号（デフォルト 1）'),
      per_page: z
        .number()
        .int()
        .min(1)
        .max(10000)
        .optional()
        .describe('1ページあたりの件数（デフォルト 10、最大 10000）'),
    }),
    handler: async (args: {
      start_date?: string;
      end_date?: string;
      account_id?: string;
      is_realized?: boolean;
      page?: number;
      per_page?: number;
    }) => {
      try {
        if (!args.start_date && !args.end_date) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'エラー: start_date と end_date のいずれかを指定する必要がある。',
              },
            ],
            isError: true,
          };
        }

        const result = await listJournals(args);
        const { metadata, journals } = result;

        const journalText = journals
          .map((j) => {
            const branchesText = j.branches
              .map((b, i) => {
                const debit = formatJournalDetails(b.debitor);
                const credit = formatJournalDetails(b.creditor);
                const remark = b.remark ? `\n      remark: ${b.remark}` : '';
                return `    [${i + 1}] 借方 { ${debit} }\n        貸方 { ${credit} }${remark}`;
              })
              .join('\n');
            const tagsText = j.tags.length ? ` tags=[${j.tags.join(', ')}]` : '';
            const memoText = j.memo ? ` memo="${j.memo}"` : '';
            return `- #${j.number} ${j.transaction_date} (${j.journal_type}) ${j.entered_by}${tagsText}${memoText}\n  ID: ${j.id}\n${branchesText}`;
          })
          .join('\n\n');

        const total = metadata.total_count;
        const page = args.page ?? 1;
        const perPage = args.per_page ?? 10;
        return {
          content: [
            {
              type: 'text' as const,
              text: `仕訳一覧 (${page}/${metadata.total_pages}ページ, 全${total}件, per_page=${perPage})\n\n${journalText || '該当する仕訳がない'}`,
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

  mf_accounting_get_journal: {
    description: '会計仕訳の詳細を取得する',
    inputSchema: z.object({
      journal_id: z.string().describe('仕訳ID'),
    }),
    handler: async (args: { journal_id: string }) => {
      try {
        const { journal: j } = await getJournal(args.journal_id);

        const branchesText = j.branches
          .map((b, i) => {
            const debit = formatJournalDetails(b.debitor);
            const credit = formatJournalDetails(b.creditor);
            const remark = b.remark ? `\n      remark: ${b.remark}` : '';
            return `  [${i + 1}] 借方 { ${debit} }\n      貸方 { ${credit} }${remark}`;
          })
          .join('\n');

        const tagsText = j.tags.length ? `\nタグ: ${j.tags.join(', ')}` : '';
        const memoText = j.memo ? `\nメモ: ${j.memo}` : '';
        const voucherText = j.voucher_file_ids.length
          ? `\n証憑ID: ${j.voucher_file_ids.join(', ')}`
          : '';

        return {
          content: [
            {
              type: 'text' as const,
              text: `仕訳詳細\n\nID: ${j.id}\n番号: ${j.number}\n取引日: ${j.transaction_date}\n会計年度: ${j.term_period}\n仕訳区分: ${j.journal_type}\n作成元: ${j.entered_by}\n実現: ${j.is_realized}${memoText}${tagsText}${voucherText}\n作成日時: ${j.create_time}\n更新日時: ${j.update_time}\n\n${branchesText}`,
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

  mf_accounting_create_journal: {
    description:
      '会計仕訳を新規作成する（POST /api/v3/journals）。' +
      'dry_run=true の場合は API を呼ばず、組み立てたリクエストボディを JSON で返す。' +
      '冪等性キー（memo の決定的キー、tags=mf-mcp:auto 等）は呼び出し側で組み立てて memo / tags に渡すこと。' +
      '事前に各 branch の借貸合計が一致することを検証する。',
    inputSchema: z.object({
      transaction_date: dateSchema.describe('取引日（YYYY-MM-DD）'),
      journal_type: journalTypeEnum
        .default('journal_entry')
        .describe('仕訳区分。期末調整のみ adjusting_entry'),
      memo: z.string().optional().describe('メモ（冪等性キーを埋める場合はここ）'),
      tags: z.array(z.string()).optional().describe('タグ配列（例: ["mf-mcp:auto", "monthly"]）'),
      branches: z
        .array(journalLineInputSchema)
        .min(1)
        .describe('借貸ペアの配列（複合仕訳可、最低 1 件）'),
      dry_run: z
        .boolean()
        .default(false)
        .describe('true なら API を呼ばず、組み立てたリクエストボディを返す'),
    }),
    handler: async (args: {
      transaction_date: string;
      journal_type: 'journal_entry' | 'adjusting_entry';
      memo?: string;
      tags?: string[];
      branches: JournalLineInput[];
      dry_run: boolean;
    }) => {
      try {
        validateJournalBalance(args.branches);

        const body = buildCreateJournalBody({
          transaction_date: args.transaction_date,
          journal_type: args.journal_type,
          memo: args.memo,
          tags: args.tags,
          branches: args.branches,
        });

        if (args.dry_run) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `[dry-run] POST /api/v3/journals は実行しない。組み立てたリクエストボディ:\n\n${JSON.stringify(body, null, 2)}`,
              },
            ],
          };
        }

        const { journal: j } = await createJournal(body);

        const summaryBranches = j.branches
          .map(
            (b, i) =>
              `  [${i + 1}] 借方 { ${formatJournalDetailsInput(b.debitor)} } / 貸方 { ${formatJournalDetailsInput(b.creditor)} }`,
          )
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `仕訳を作成した\n\n${formatResultJournal(j)}\n\n（参考）送信値ベース:\n${summaryBranches}`,
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

  mf_accounting_update_journal: {
    description:
      '既存の会計仕訳を更新する（PUT /api/v3/journals/{id}）。' +
      'dry_run=true の場合は API を呼ばず、組み立てたリクエストボディを JSON で返す。' +
      '事前に各 branch の借貸合計が一致することを検証する。',
    inputSchema: z.object({
      journal_id: z.string().describe('更新対象の仕訳ID'),
      transaction_date: dateSchema.describe('取引日（YYYY-MM-DD）'),
      journal_type: journalTypeEnum
        .optional()
        .describe(
          '仕訳区分。**省略すると更新前の区分を引き継ぐ**（既存の adjusting_entry を'
          + '黙って journal_entry に戻さないため）。dry_run=true のときは API を呼ばないので必ず明示する'
        ),
      memo: z.string().optional().describe('メモ'),
      tags: z.array(z.string()).optional().describe('タグ配列'),
      branches: z
        .array(journalLineInputSchema)
        .min(1)
        .describe('借貸ペアの配列（最低 1 件、指定時は全置換）'),
      dry_run: z
        .boolean()
        .default(false)
        .describe('true なら API を呼ばず、組み立てたリクエストボディを返す'),
    }),
    handler: async (args: {
      journal_id: string;
      transaction_date: string;
      journal_type?: 'journal_entry' | 'adjusting_entry';
      memo?: string;
      tags?: string[];
      branches: JournalLineInput[];
      dry_run: boolean;
    }) => {
      try {
        validateJournalBalance(args.branches);

        // journal_type 未指定なら既存仕訳の区分を読み取って引き継ぐ。
        // 既定値を送ると adjusting_entry が journal_entry に戻ってしまう。
        let journalType = args.journal_type;
        if (!journalType) {
          // dry_run はオフラインで完結させる契約。既存区分の取得に API を呼ぶと
          // 「API を呼ばない」という約束を破り、未認証では失敗する。
          if (args.dry_run) {
            throw new Error(
              'dry_run=true では既存の仕訳区分を取得しません。journal_type を明示してください。'
            );
          }
          const { journal: current } = await getJournal(args.journal_id);
          journalType = current.journal_type === 'adjusting_entry'
            ? 'adjusting_entry'
            : 'journal_entry';
        }

        const body = buildCreateJournalBody({
          transaction_date: args.transaction_date,
          journal_type: journalType,
          memo: args.memo,
          tags: args.tags,
          branches: args.branches,
        });

        if (args.dry_run) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `[dry-run] PUT /api/v3/journals/${args.journal_id} は実行しない。組み立てたリクエストボディ:\n\n${JSON.stringify(body, null, 2)}`,
              },
            ],
          };
        }

        const { journal: j } = await updateJournal(args.journal_id, body);

        return {
          content: [
            {
              type: 'text' as const,
              text: `仕訳を更新した\n\n${formatResultJournal(j)}`,
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

  mf_accounting_delete_journal: {
    description:
      '会計仕訳を削除する（DELETE /api/v3/journals/{id}）。' +
      '不可逆操作。誤削除防止のため confirm=true を必ず指定する。',
    inputSchema: z.object({
      journal_id: z.string().describe('削除対象の仕訳ID'),
      confirm: z
        .literal(true)
        .describe('不可逆操作の確認。true を明示的に指定する必要がある'),
    }),
    handler: async (args: { journal_id: string; confirm: true }) => {
      try {
        if (args.confirm !== true) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'エラー: confirm=true を指定する必要がある（不可逆操作）。',
              },
            ],
            isError: true,
          };
        }

        await deleteJournal(args.journal_id);

        return {
          content: [
            {
              type: 'text' as const,
              text: `仕訳を削除した\nID: ${args.journal_id}`,
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
