import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = ['README.md', 'README.ja.md', 'CONTRIBUTING.md'];

function read(doc) {
  return fs.readFileSync(path.join(root, doc), 'utf-8');
}

test('no documented snippet uses read -p, which silently fails in zsh', () => {
  // zsh's read -p means "read from a coprocess": it prints no prompt, errors
  // with "no coprocess", and leaves the variable empty — so a reader pasting
  // the setup would register the connector with blank credentials.
  const offenders = [];
  for (const doc of DOCS) {
    read(doc)
      .split('\n')
      .forEach((line, i) => {
        if (/^\s*read\s+(-\w+\s+)*-\w*p\b/.test(line) || /\bread\s+-rs?\s+-p\b/.test(line)) {
          offenders.push(`${doc}:${i + 1}: ${line.trim()}`);
        }
      });
  }
  assert.deepEqual(offenders, [], `use "printf '...'; read -rs VAR" instead:\n${offenders.join('\n')}`);
});

test('the prompt-and-read pattern in the docs works in both bash and zsh', () => {
  // Take the pattern as documented and run it under each shell.
  const snippet = `
    printf 'secret: '; read -rs SECRET; echo
    printf 'got=[%s]\\n' "$SECRET"
  `;
  for (const shell of ['bash', 'zsh']) {
    const out = execFileSync(shell, ['-c', snippet], {
      input: 'hunter2\n',
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    assert.match(out, /got=\[hunter2\]/, `${shell} did not capture the value: ${out}`);
  }
});

test('the credential-file recipe creates the file owner-only', () => {
  for (const doc of ['README.md', 'README.ja.md']) {
    const body = read(doc);
    if (!body.includes('credentials.env')) continue;
    // Sourcing a file the reader had to create themselves said nothing about
    // its mode. The recipe must establish 0600 before any secret is written.
    assert.match(body, /umask 077/, `${doc} describes a credentials file without umask 077`);
    const umaskAt = body.indexOf('umask 077');
    const sourceAt = body.indexOf('. ~/.config/mf-mcp/credentials.env');
    assert.ok(umaskAt > -1 && sourceAt > umaskAt, `${doc}: umask must come before sourcing`);
  }
});

/** Every ```bash fence in a doc. */
function bashBlocks(doc) {
  return read(doc).split('```bash').slice(1).map((b) => b.split('```')[0]);
}

test('registration in the docs is conditional on the credentials being entered', () => {
  for (const doc of ['README.md', 'README.ja.md']) {
    for (const block of bashBlocks(doc)) {
      if (!block.includes('claude mcp add moneyforward')) continue;
      if (!block.includes('read -rs')) continue;      // only the prompt blocks
      // Either an explicit pair check (the invoice-only quick start) or the
      // accumulator form, which registers whatever pairs are complete.
      assert.ok(
        /if \[ -n "\$MF_INVOICE_CLIENT_ID" \]/.test(block) || /\[ "\$#" -gt 0 \]/.test(block),
        `${doc}: a block prompts for credentials then registers unconditionally`,
      );
    }
  }
});

/**
 * Pull the gating logic (from `set --` onward) out of the documented setup
 * block so it can be executed directly with chosen credentials.
 */
function gatingSnippet(doc) {
  const block = bashBlocks(doc).find((b) => b.includes('set --'));
  assert.ok(block, `${doc} has no accumulator block`);
  return block.slice(block.indexOf('set --'));
}

const PAIRS = {
  invoice: ['MF_INVOICE_CLIENT_ID', 'MF_INVOICE_CLIENT_SECRET'],
  expense: ['MF_EXPENSE_CLIENT_ID', 'MF_EXPENSE_CLIENT_SECRET'],
  accounting: ['MF_ACCOUNTING_CLIENT_ID', 'MF_ACCOUNTING_CLIENT_SECRET'],
};

/** Run the documented gate under one shell with a stubbed `claude`. */
function runGate(doc, shell, env) {
  const snippet = `claude() { printf 'REGISTERED %s\\n' "$*"; }\n${gatingSnippet(doc)}`;
  return execFileSync(shell, ['-c', snippet], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

for (const doc of ['README.md', 'README.ja.md']) {
  for (const shell of ['bash', 'zsh']) {
    for (const product of Object.keys(PAIRS)) {
      test(`${doc} (${shell}): a ${product}-only setup still registers`, () => {
        // The regression: the gate required the invoice pair, so an
        // expense-only or accounting-only setup silently registered nothing.
        const env = Object.fromEntries(
          Object.values(PAIRS).flat().map((key) => [key, '']),
        );
        for (const key of PAIRS[product]) env[key] = `${product}-value`;

        const out = runGate(doc, shell, env);
        assert.match(out, /^REGISTERED /m, `nothing was registered for ${product}: ${out}`);
        for (const key of PAIRS[product]) {
          assert.match(out, new RegExp(`--env ${key}=${product}-value`), out);
        }
        for (const [other, keys] of Object.entries(PAIRS)) {
          if (other === product) continue;
          for (const key of keys) {
            assert.doesNotMatch(out, new RegExp(`--env ${key}=`), `${key} leaked: ${out}`);
          }
        }
      });
    }

    test(`${doc} (${shell}): every complete pair is registered together`, () => {
      const env = Object.fromEntries(
        Object.entries(PAIRS).flatMap(([product, keys]) => keys.map((k) => [k, `${product}-value`])),
      );
      const out = runGate(doc, shell, env);
      for (const key of Object.values(PAIRS).flat()) {
        assert.match(out, new RegExp(`--env ${key}=`), out);
      }
    });

    test(`${doc} (${shell}): an id without its secret registers nothing`, () => {
      const env = Object.fromEntries(Object.values(PAIRS).flat().map((key) => [key, '']));
      env.MF_EXPENSE_CLIENT_ID = 'expense-value';   // secret deliberately absent
      const out = runGate(doc, shell, env);
      assert.doesNotMatch(out, /^REGISTERED /m, `a half-configured product was registered: ${out}`);
      assert.doesNotMatch(out, /--env MF_EXPENSE_CLIENT_ID=/, out);
    });

    test(`${doc} (${shell}): no credentials at all registers nothing`, () => {
      const env = Object.fromEntries(Object.values(PAIRS).flat().map((key) => [key, '']));
      const out = runGate(doc, shell, env);
      assert.doesNotMatch(out, /^REGISTERED /m, out);
    });
  }
}
