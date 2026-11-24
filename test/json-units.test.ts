import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import './env.ts';
import { neon, parsePhpstan } from '../src/engines/phpstan.ts';
import { jsonFiles, loadSchema, schemaUrl, syntaxFinding, validate } from '../src/engines/wp-json.ts';
import { categorise, pluginRuleset } from '../src/engines/wpcs.ts';
import { EngineSkipped } from '../src/types.ts';
import type { Target } from '../src/types.ts';
import { fakeNet, makeTheme, tmp, write } from './helpers.ts';

test('categorise knows the Plugin Check rules', () => {
  assert.equal(categorise('PluginCheck.CodeAnalysis.ShortURL.Found'), 'correctness');
  assert.equal(categorise('PluginCheck.Security.X'), 'security');
  assert.equal(categorise('Generic.Files.ByteOrderMark.Found'), 'correctness');
});

test('pluginRuleset writes the file once', (t) => {
  const tools = tmp(t);
  const file = pluginRuleset(tools);
  assert.equal(file, path.join(tools, 'wp-shakedown-plugin.xml'));
  const text = readFileSync(file, 'utf8');
  assert.ok(text.includes('<rule ref="WordPress-Extra"/>'));
  assert.ok(text.includes('<rule ref="./vendor/plugin-check/phpcs-sniffs/phpcs-rulesets/plugin-review.xml"/>'));
  writeFileSync(file, 'kept');
  pluginRuleset(tools);
  assert.equal(readFileSync(file, 'utf8'), 'kept');
});

test('neon builds the config', () => {
  const base = { tools: '/t', target: '/p', isFile: false, tmpDir: '/c', exclude: [] };
  const plain = neon(base);
  assert.ok(plain.includes("\t- '/t/vendor/szepeviktor/phpstan-wordpress/extension.neon'"));
  assert.ok(plain.includes('level: 5') && plain.includes("- '/p'"));
  assert.ok(!plain.includes('excludePaths') && !plain.includes('scanDirectories'));
  assert.ok(neon({ ...base, target: "/it's" }).includes("'/it''s'"));
  const full = neon({ ...base, vendor: '/p/vendor', exclude: ['/p/vendor'] });
  assert.ok(full.includes('excludePaths:\n\t\tanalyse:\n\t\t\t- \'/p/vendor\''));
  assert.ok(full.includes("scanDirectories:\n\t\t- '/p/vendor'"));
});

test('parsePhpstan reads the JSON report', () => {
  const json = JSON.stringify({
    totals: {},
    files: {
      '/base/a.php': {
        messages: [
          { message: 'Function x not found.', line: 4, identifier: 'function.notFound', tip: 'Learn more\nat the docs' },
          { message: 'Odd.', line: null },
        ],
      },
      '/other/b.php': { messages: [{ message: 'M', line: 1 }] },
    },
    errors: [],
  });
  const f = parsePhpstan(json, '/base');
  assert.deepEqual(f[0], {
    rule: 'function.notFound', severity: 'warning', category: 'correctness', message: 'Function x not found.',
    location: { file: 'a.php', line: 4 }, hint: 'Learn more at the docs',
  });
  assert.deepEqual(f[1]!.location, { file: 'a.php' });
  assert.equal(f[1]!.rule, 'phpstan');
  assert.equal(f[2]!.location.file, '/other/b.php');
  assert.throws(() => parsePhpstan(JSON.stringify({ files: {}, errors: ['Bad config', 'x'] }), '/b'), { message: 'PHPStan stopped: Bad config' });
  assert.throws(() => parsePhpstan('garbage', '/b'), { message: 'PHPStan returned output that is not JSON.' });
  assert.throws(() => parsePhpstan('{}', '/b'), { message: 'PHPStan returned output that is not JSON.' });
});

test('jsonFiles finds theme and block files', (t) => {
  const dir = tmp(t);
  makeTheme(dir);
  for (const f of ['theme.json', 'styles/dark.json', 'styles/blocks/x.json', 'blocks/a/block.json', 'node_modules/b/block.json']) write(path.join(dir, f), '{}');
  const theme: Target = { kind: 'theme', path: dir, name: 't', units: [] };
  const rel = (x: { file: string; kind: string }[]) => x.map((e) => `${e.kind}:${path.relative(dir, e.file).split(path.sep).join('/')}`);
  assert.deepEqual(rel(jsonFiles(theme)), ['block:blocks/a/block.json', 'theme:styles/blocks/x.json', 'theme:styles/dark.json', 'theme:theme.json']);
  assert.deepEqual(rel(jsonFiles({ ...theme, kind: 'plugin' })), ['block:blocks/a/block.json']);
  assert.deepEqual(jsonFiles({ ...theme, path: path.join(dir, 'theme.json') }), []);
});

test('schemaUrl keeps only a matching WordPress schema', () => {
  assert.equal(schemaUrl('theme', 'https://schemas.wp.org/wp/6.8/theme.json'), 'https://schemas.wp.org/wp/6.8/theme.json');
  assert.equal(schemaUrl('block', 'https://schemas.wp.org/wp/6.8/theme.json'), 'https://schemas.wp.org/trunk/block.json');
  assert.equal(schemaUrl('theme', 42), 'https://schemas.wp.org/trunk/theme.json');
  assert.equal(schemaUrl('theme', 'https://evil.example/theme.json'), 'https://schemas.wp.org/trunk/theme.json');
});

test('validate reports schema problems', () => {
  const schema = { type: 'object', additionalProperties: false, properties: { version: { enum: [2, 3] } } };
  const extra = validate(schema, { nope: 1 });
  assert.equal(extra[0]!.rule, 'schema.additionalProperties');
  assert.equal(extra[0]!.message, '/: "nope" is not a known property');
  const bad = validate(schema, { version: 9 });
  assert.equal(bad[0]!.rule, 'schema.enum');
  assert.ok(bad[0]!.message.endsWith(': 2, 3'));
  assert.deepEqual(validate(schema, { version: 2 }), []);
});

test('syntaxFinding picks the line', () => {
  assert.deepEqual(syntaxFinding(new Error('Bad token (line 3 column 5)')), { message: 'Bad token (line 3 column 5)', line: 3 });
  assert.deepEqual(syntaxFinding(new Error('Bad')), { message: 'Bad' });
});

test('loadSchema uses the cache and skips without a network', async (t) => {
  const calls = fakeNet(t, new Map([['https://schemas.invalid/cached.json', { status: 200, body: { type: 'object' } }]]));
  assert.deepEqual(await loadSchema('https://schemas.invalid/cached.json'), { type: 'object' });
  await loadSchema('https://schemas.invalid/cached.json');
  assert.equal(calls.length, 1);
  await assert.rejects(loadSchema('https://schemas.invalid/missing.json'), EngineSkipped);
});

test('validate reports a rejected property name once', () => {
  const schema = { type: 'object', properties: { settings: { type: 'object', propertyNames: { enum: ['color', 'spacing'] } } } };
  const found = validate(schema, { settings: { colour: {} } });
  assert.deepEqual(found, [{ rule: 'schema.propertyNames', message: '/settings: "colour" is not a known property' }]);
});
