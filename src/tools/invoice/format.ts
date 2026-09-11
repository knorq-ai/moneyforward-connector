import type { MoneyString } from '../../types/index.js';

/**
 * 請求書 API が返す数値文字列（例 `"123456.0"`）を表示用に整形する。
 *
 * 未設定・パース不能な場合は `-` を返す。0 を `-` にしないよう、
 * 「値が無い」と「0 円」は区別する。
 */
export function formatMoney(value: MoneyString | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '-';
  return `¥${n.toLocaleString('ja-JP')}`;
}

/** 数量の整形。`"1.0"` → `1`、`"130.5"` → `130.5`。 */
export function formatQuantity(value: MoneyString | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return String(n);
}
