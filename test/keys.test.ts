import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { anthropicKey, removeAnthropicKey, saveAnthropicKey } from '../src/assistant/keys.ts';
import './env.ts';
import { tmp } from './helpers.ts';

function setEnv(t: TestContext, home: string, key?: string): void {
  const old = { home: process.env.WP_SHAKEDOWN_HOME, key: process.env.ANTHROPIC_API_KEY };
  process.env.WP_SHAKEDOWN_HOME = home;
  if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = key;
  t.after(() => {
    for (const [name, v] of [['WP_SHAKEDOWN_HOME', old.home], ['ANTHROPIC_API_KEY', old.key]] as const) {
      if (v === undefined) delete process.env[name];
      else process.env[name] = v;
    }
  });
}

test('the environment key wins over the file', (t) => {
  setEnv(t, tmp(t), 'from-env');
  saveAnthropicKey('from-file');
  assert.equal(anthropicKey(), 'from-env');
});

test('saveAnthropicKey writes a private file and anthropicKey reads it', (t) => {
  const home = tmp(t);
  setEnv(t, home);
  assert.equal(anthropicKey(), undefined);
  const file = saveAnthropicKey(' sk-test \n');
  assert.equal(file, path.join(home, 'keys', 'anthropic'));
  assert.equal(readFileSync(file, 'utf8').trim(), 'sk-test');
  assert.equal(anthropicKey(), 'sk-test');
  if (process.platform !== 'win32') {
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(path.dirname(file)).mode & 0o777, 0o700);
  }
});

test('a key file that others can read is refused', { skip: process.platform === 'win32' }, (t) => {
  setEnv(t, tmp(t));
  const file = saveAnthropicKey('sk-test');
  chmodSync(file, 0o644);
  assert.throws(() => anthropicKey(), new RegExp(`The key file ${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} can be read by other users\\. Run chmod 600`));
});

test('removeAnthropicKey deletes the file and says whether there was one', (t) => {
  setEnv(t, tmp(t));
  assert.equal(removeAnthropicKey(), false);
  const file = saveAnthropicKey('sk-test');
  assert.equal(removeAnthropicKey(), true);
  assert.ok(!existsSync(file));
});
