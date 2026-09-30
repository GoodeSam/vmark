// WI-TP1.1: hook handshake without touching real CLI configuration.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const token = 'cb28fc00-2c1b-4eaf-9d09-71d9d5392926';
test('SessionStart binds exactly, is silent, and ignores disabled/foreign invocations', () => {
  const root = mkdtempSync(join(tmpdir(), 'vmark-transcript-'));
  try {
    const script = join(root, 'terminal-transcript-hook.cjs');
    copyFileSync('src-tauri/resources/terminal-transcript-hook.cjs', script);
    const input = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'exact', transcript_path: '/tmp/exact.jsonl' });
    const run = (env = {}) => spawnSync(process.execPath, [script], { env: { ...process.env, ...env }, input, encoding: 'utf8' });
    const dest = join(root, token + '.json');
    assert.equal(run({ VMARK_TRANSCRIPT_TOKEN: token }).status, 0);
    assert.equal(existsSync(dest), false);
    writeFileSync(join(root, 'enabled'), 'enabled');
    assert.equal(run({ VMARK_TRANSCRIPT_TOKEN: '../invalid' }).status, 0);
    assert.equal(existsSync(dest), false);
    const result = run({ VMARK_TRANSCRIPT_TOKEN: token });
    assert.equal(result.status, 0); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(readFileSync(dest, 'utf8')), { path: '/tmp/exact.jsonl', sessionId: 'exact' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
