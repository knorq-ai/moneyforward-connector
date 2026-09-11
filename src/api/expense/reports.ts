import { pathParam } from '../path.js';
import { getExpenseClient } from '../client.js';
import type { ExReport, ExTransaction } from '../../types/index.js';

export async function listMyExReports(officeId: string, params?: {
  page?: number;
  limit?: number;
}): Promise<ExReport[]> {
  const result = await getExpenseClient().get<{ ex_reports?: ExReport[] }>(
    `/offices/${pathParam(officeId, 'office_id')}/me/ex_reports`,
    {
      page: params?.page,
      limit: params?.limit,
    }
  );
  return result.ex_reports || [];
}

export async function getExReport(officeId: string, reportId: string): Promise<ExReport> {
  return getExpenseClient().get<ExReport>(
    `/offices/${pathParam(officeId, 'office_id')}/me/ex_reports/${pathParam(reportId, 'report_id')}`
  );
}

export async function listReportTransactions(officeId: string, reportId: string, params?: {
  page?: number;
  limit?: number;
}): Promise<ExTransaction[]> {
  const result = await getExpenseClient().get<{ ex_transactions?: ExTransaction[] }>(
    `/offices/${pathParam(officeId, 'office_id')}/ex_reports/${pathParam(reportId, 'report_id')}/ex_transactions`,
    {
      page: params?.page,
      limit: params?.limit,
    }
  );
  return result.ex_transactions || [];
}

/**
 * 経費申請の明細を全ページ取得する。
 *
 * 1 ページだけ取って合計を出すと、上限を超える申請の合計が実際より小さく表示される
 * （= 承認判断を誤る）。ページを尽きるまで辿り、打ち切った場合は complete=false を返す。
 */
const REPORT_TX_PAGE_SIZE = 100;
const REPORT_TX_MAX_PAGES = 50;

export async function listAllReportTransactions(
  officeId: string,
  reportId: string,
): Promise<{ transactions: ExTransaction[]; complete: boolean }> {
  const all: ExTransaction[] = [];
  for (let page = 1; page <= REPORT_TX_MAX_PAGES; page += 1) {
    const batch = await listReportTransactions(officeId, reportId, {
      page,
      limit: REPORT_TX_PAGE_SIZE,
    });
    all.push(...batch);
    if (batch.length < REPORT_TX_PAGE_SIZE) {
      return { transactions: all, complete: true };
    }
  }
  return { transactions: all, complete: false };
}

export async function approveExReport(officeId: string, reportId: string): Promise<ExReport> {
  return getExpenseClient().post<ExReport>(
    `/offices/${pathParam(officeId, 'office_id')}/me/approving_ex_reports/${pathParam(reportId, 'report_id')}/approve`,
    {}
  );
}

export async function disapproveExReport(officeId: string, reportId: string): Promise<ExReport> {
  return getExpenseClient().post<ExReport>(
    `/offices/${pathParam(officeId, 'office_id')}/me/approving_ex_reports/${pathParam(reportId, 'report_id')}/disapprove`,
    {}
  );
}
