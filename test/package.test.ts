import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolveCommand } from '../src/command.ts';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const built = existsSync(path.join(root, 'dist', 'cli.js')) && existsSync(path.join(root, 'ui', 'dist', 'index.html'));

// ui/.gitignore ignores dist, and npm follows it unless ui/.npmignore exists. Version 0.1.0 almost shipped without the page.
test('the npm package holds the command, the page and the tool manifests', { skip: built ? false : 'Run npm run build first' }, () => {
  const [npm, args] = resolveCommand('npm', ['pack', '--dry-run', '--json', '--ignore-scripts']);
  const r = spawnSync(npm, args, { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  // Older npm prints an array, newer npm an object keyed by the package name.
  const parsed = JSON.parse(r.stdout) as unknown;
  const entry = (Array.isArray(parsed) ? parsed[0] : Object.values(parsed as object)[0]) as { files: { path: string }[] };
  const files = entry.files.map((f) => f.path);
  for (const needed of ['dist/cli.js', 'dist/index.js', 'ui/dist/index.html', 'php-tools/composer.json', 'php-tools/composer.lock', 'php-tools/theme-check.php', 'js-tools/package.json', 'js-tools/package-lock.json', 'js-tools/eslint.config.mjs', 'js-tools/stylelint.config.mjs', 'php-wasm/package.json', 'php-wasm/package-lock.json', 'php-wasm/php.mjs', 'ai-tools/package.json', 'ai-tools/package-lock.json', 'README.md', 'LICENSE']) {
    assert.ok(files.includes(needed), `${needed} is missing from the package`);
  }
  assert.ok(files.some((f) => /^ui\/dist\/assets\/.+\.js$/.test(f)), 'the page script is missing from the package');
  assert.ok(!files.some((f) => f.startsWith('test/') || f.startsWith('src/') || f.startsWith('.dev/') || f.includes('node_modules/')), 'the package holds files it should not');
});
