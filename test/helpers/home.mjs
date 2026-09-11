import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * The user's real home, captured before anything here overrides it. Tests
 * assert against this to prove they are not operating on real storage.
 */
export const REAL_HOME = os.homedir();
export const REAL_TOKEN_DIR = path.join(REAL_HOME, '.config', 'mf-mcp');
export const REAL_LEGACY_DIR = path.join(REAL_HOME, '.config', 'mf-invoice-mcp');

const created = [];

/**
 * Point HOME at a fresh temp directory for the rest of this test process.
 *
 * Every production path that matters — the token cache, the legacy migration
 * source, the receipt-upload denylist — is derived from `os.homedir()`, which
 * reads `$HOME` on POSIX. Without this, running the suite on a real
 * installation would chmod the user's live token files and copy them into
 * fixtures. Call this BEFORE importing any module under test.
 */
export function useTempHome(label = 'mf-test-home-') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), label));
  process.env.HOME = home;
  process.env.USERPROFILE = home;            // Windows equivalent
  process.env.XDG_CONFIG_HOME = path.join(home, '.config');
  created.push(home);

  if (os.homedir() !== home) {
    throw new Error(
      `failed to isolate HOME: os.homedir() is ${os.homedir()}, expected ${home}`,
    );
  }
  return home;
}

/** Remove every temp home this process created. */
export function cleanupTempHomes() {
  while (created.length > 0) {
    fs.rmSync(created.pop(), { recursive: true, force: true });
  }
}

/** Throw if the current process is still pointed at the user's real home. */
export function assertIsolated() {
  if (os.homedir() === REAL_HOME) {
    throw new Error('test is running against the real home directory');
  }
}
