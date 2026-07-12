import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ANSI_RE = /\u001b\[[0-9;]*m/g;

export function makeTempDir(prefix = 'mtn-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function stripAnsi(text) {
  return text.replace(ANSI_RE, '');
}

export function runCli(args, opts = {}) {
  const isolatedConfigDir = join(makeTempDir('mtn-config-'), 'config');
  const result = spawnSync(process.execPath, ['dist/cli.js', ...args], {
    cwd: opts.cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      MDBASE_TASKNOTES_CONFIG_DIR: isolatedConfigDir,
      ...(opts.env || {}),
    },
  });

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || result.error?.message || '',
  };
}
