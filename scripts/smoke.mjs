#!/usr/bin/env node
/**
 * stdio 経由で MCP ハンドシェイクと tools/list を行う最小スモークテスト。
 * 認証情報は不要（OAuth クライアントはツール呼び出し時に遅延生成される）。
 *
 *   npm run build && npm run smoke
 *
 * 成功時は登録ツール数とドメイン別の内訳を表示して exit 0、
 * ハンドシェイク失敗・ツール 0 件・必須ツール欠落なら exit 1。
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'dist', 'index.js');
const TIMEOUT_MS = 20_000;

// 最低限ここが生えていないと公開物として壊れている、というツール
const REQUIRED_TOOLS = [
  'mf_auth_start',
  'mf_list_billings',
  'mf_create_billing',
  'mf_delete_billing',
  'mf_expense_auth_start',
  'mf_expense_list_transactions',
  'mf_accounting_auth_start',
  'mf_accounting_create_journal',
];

function fail(message) {
  console.error(`smoke: FAIL — ${message}`);
  process.exit(1);
}

const child = spawn(process.execPath, [ENTRY], {
  stdio: ['pipe', 'pipe', 'pipe'],
  // 認証情報は意図的に渡さない。tools/list が env に依存しないことの確認も兼ねる。
  env: { ...process.env, MF_CLIENT_ID: '', MF_CLIENT_SECRET: '' },
});

let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

const timer = setTimeout(() => {
  child.kill('SIGKILL');
  fail(`${TIMEOUT_MS}ms 以内に応答がなかった。stderr: ${stderr.trim() || '(empty)'}`);
}, TIMEOUT_MS);

const pending = new Map();
let buffer = '';

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue; // JSON-RPC 以外の出力は無視する
    }
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  }
});

child.on('exit', (code, signal) => {
  if (pending.size > 0) {
    clearTimeout(timer);
    fail(`サーバーが応答前に終了した (code=${code} signal=${signal})。stderr: ${stderr.trim() || '(empty)'}`);
  }
});

function send(id, method, params) {
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

const init = await send(1, 'initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'smoke-test', version: '0.0.0' },
});

if (init.error) fail(`initialize がエラーを返した: ${JSON.stringify(init.error)}`);
if (!init.result?.serverInfo?.name) fail('initialize のレスポンスに serverInfo が無い');

notify('notifications/initialized', {});

const listed = await send(2, 'tools/list', {});
clearTimeout(timer);

if (listed.error) fail(`tools/list がエラーを返した: ${JSON.stringify(listed.error)}`);

const tools = listed.result?.tools;
if (!Array.isArray(tools) || tools.length === 0) fail('tools/list が空だった');

const names = new Set(tools.map((t) => t.name));
const missing = REQUIRED_TOOLS.filter((name) => !names.has(name));
if (missing.length > 0) fail(`必須ツールが欠落: ${missing.join(', ')}`);

const malformed = tools.filter((t) => !t.name || !t.description || !t.inputSchema);
if (malformed.length > 0) {
  fail(`name / description / inputSchema が欠けたツール: ${malformed.map((t) => t.name).join(', ')}`);
}

const byDomain = {
  invoice: tools.filter((t) => !t.name.startsWith('mf_expense_') && !t.name.startsWith('mf_accounting_')).length,
  expense: tools.filter((t) => t.name.startsWith('mf_expense_')).length,
  accounting: tools.filter((t) => t.name.startsWith('mf_accounting_')).length,
};

console.log(`smoke: OK — server=${init.result.serverInfo.name}@${init.result.serverInfo.version}`);
console.log(`smoke: tools=${tools.length} (invoice=${byDomain.invoice}, expense=${byDomain.expense}, accounting=${byDomain.accounting})`);

child.kill('SIGTERM');
process.exit(0);
