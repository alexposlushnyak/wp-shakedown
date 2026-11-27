import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import './env.ts';
import { config, configFindings } from '../src/engines/config.ts';
import { detectTarget } from '../src/target.ts';
import { tmp, write } from './helpers.ts';

const SALT = 'Zq9#x/*y7w$long-secret-phrase-0123456789';
const keys = (v: (k: string) => string) =>
  ['AUTH_KEY', 'SECURE_AUTH_KEY', 'LOGGED_IN_KEY', 'NONCE_KEY', 'AUTH_SALT', 'SECURE_AUTH_SALT', 'LOGGED_IN_SALT', 'NONCE_SALT'].map((k) => `define( '${k}', ${v(k)} );`).join('\n');
const good = `<?php\n${keys(() => `'${SALT}'`)}\ndefine( 'DISALLOW_FILE_EDIT', true );\n`;
const rules = (t: string) => configFindings(t).map((f) => f.rule);

test('configFindings: a good file is clean', () => assert.deepEqual(rules(good), []));

test('configFindings: debug', () => {
  assert.deepEqual(rules(`${good}define( 'WP_DEBUG', TRUE );`), ['config.debug']);
  assert.deepEqual(rules(`${good}define( 'WP_DEBUG', false );`), []);
});

test('configFindings: salts', () => {
  assert.deepEqual(rules(`<?php\n${keys(() => "'put your unique phrase here'")}\ndefine('DISALLOW_FILE_EDIT', true);`), ['config.salts']);
  assert.deepEqual(rules(`<?php\n${keys((k) => (k === 'NONCE_SALT' ? "'short-value-1234'" : `'${SALT}'`))}\ndefine('DISALLOW_FILE_EDIT', true);`), ['config.salts']);
  assert.deepEqual(rules(good.replace("define( 'NONCE_SALT'", "define( 'OTHER'")), ['config.salts']);
  assert.deepEqual(rules(`<?php\n${keys((k) => `getenv('${k}')`)}\ndefine('DISALLOW_FILE_EDIT', true);`), []);
});

test('configFindings: comments are ignored and findings never carry a value', () => {
  const text = `${good}// define( 'WP_DEBUG', true );\n/* define( 'WP_DEBUG', true ); */\n# define( 'WP_DEBUG', true );\n`;
  assert.deepEqual(rules(text), []);
  assert.deepEqual(rules('<?php\n// define( "DISALLOW_FILE_EDIT", true );\n').includes('config.file-edit'), true);
  const bad = configFindings(`<?php\n${keys(() => "'short-secret-xyz'")}\ndefine('WP_DEBUG', true);`);
  for (const f of bad) assert.ok(!`${f.message} ${f.hint}`.includes('short-secret-xyz'));
});

test('config run finds risky files', async (t) => {
  const dir = tmp(t);
  write(path.join(dir, 'wp-includes/version.php'), "<?php $wp_version = '6.8';\n");
  write(path.join(dir, 'wp-config.php'), good);
  chmodSync(path.join(dir, 'wp-config.php'), 0o666);
  for (const f of ['wp-config.php.bak', 'dump.sql', 'phpinfo.php', '.env', 'wp-content/debug.log', 'wp-content/uploads/2026/x.php']) write(path.join(dir, f), 'x');
  write(path.join(dir, 'wp-content/uploads/index.php'), '<?php // Silence is golden.\n');
  const notes: string[] = [];
  const f = await config.run({ target: detectTarget(dir), level: 6, note: (m) => notes.push(m) });
  const got = f.map((x) => `${x.rule}:${x.location.file}`).sort();
  // Windows has no group and other permission bits, so wp-config.php cannot be found writable there.
  assert.deepEqual(got, [
    ...(process.platform === 'win32' ? [] : ['config.writable:wp-config.php']), 'leftover.config-copy:wp-config.php.bak', 'leftover.debug-log:wp-content/debug.log',
    'leftover.dump:dump.sql', 'leftover.env:.env', 'leftover.tool:phpinfo.php', 'uploads.php:wp-content/uploads/2026/x.php',
  ].sort());
  assert.deepEqual(notes, []);
});

test('config run notes a missing wp-config.php', async (t) => {
  const dir = tmp(t);
  write(path.join(dir, 'wp-includes/version.php'), "<?php $wp_version = '6.8';\n");
  const notes: string[] = [];
  await config.run({ target: detectTarget(dir), level: 6, note: (m) => notes.push(m) });
  assert.deepEqual(notes, ['No wp-config.php in this folder. Its settings were not checked.']);
});
