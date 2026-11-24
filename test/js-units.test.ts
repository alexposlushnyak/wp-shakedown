import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import './env.ts';
import { categoriseJs, parseEslint } from '../src/engines/eslint.ts';
import { categoriseCss, parseStylelint } from '../src/engines/stylelint.ts';
import { isGenerated, sourceFiles } from '../src/js/files.ts';
import { tmp, write } from './helpers.ts';

test('categoriseJs groups the rules', () => {
  assert.equal(categoriseJs('jsx-a11y/alt-text'), 'accessibility');
  assert.equal(categoriseJs('@wordpress/i18n-ellipsis'), 'i18n');
  assert.equal(categoriseJs('no-var'), 'standards');
  assert.equal(categoriseJs('prefer-const'), 'standards');
  assert.equal(categoriseJs('no-undef'), 'correctness');
  assert.equal(categoriseJs('react-hooks/exhaustive-deps'), 'correctness');
});

test('parseEslint maps messages to findings', () => {
  const json = JSON.stringify([
    {
      filePath: path.resolve('/base/a/main.js'),
      messages: [
        { ruleId: null, fatal: true, severity: 2, message: 'Parsing error: x', line: 2, column: 1 },
        { ruleId: 'no-undef', severity: 2, message: "'foo' is not defined.", line: 3, column: 5 },
        { ruleId: 'no-var', severity: 2, message: 'Unexpected var.', line: 4, column: 1, fix: { range: [0, 1], text: 'let' } },
      ],
    },
  ]);
  const [fatal, undef, noVar] = parseEslint(json, path.resolve('/base'));
  assert.deepEqual(fatal, { rule: 'syntax', severity: 'error', category: 'correctness', message: 'Parsing error: x', location: { file: 'a/main.js', line: 2, column: 1 } });
  assert.equal(undef!.rule, 'no-undef');
  assert.equal(undef!.severity, 'warning');
  assert.equal(undef!.hint, undefined);
  assert.equal(noVar!.severity, 'info');
  assert.equal(noVar!.category, 'standards');
  assert.equal(noVar!.hint, 'eslint --fix can fix this.');
  assert.throws(() => parseEslint('nope', '/base'), { message: 'ESLint returned output that is not JSON.' });
  assert.throws(() => parseEslint('{}', '/base'), { message: 'ESLint returned output that is not JSON.' });
});

test('categoriseCss groups the rules', () => {
  for (const r of ['property-no-unknown', 'color-no-invalid-hex', 'no-duplicate-selectors', 'block-no-empty']) assert.equal(categoriseCss(r), 'correctness', r);
  for (const r of ['color-named', 'selector-class-pattern']) assert.equal(categoriseCss(r), 'standards', r);
});

test('parseStylelint maps warnings to findings', () => {
  const json = JSON.stringify([
    {
      source: path.resolve('/base/s.css'),
      warnings: [
        { line: 1, column: 2, rule: 'CssSyntaxError', severity: 'error', text: 'Unclosed block (CssSyntaxError)' },
        { line: 3, column: 4, rule: 'property-no-unknown', severity: 'error', text: 'Unexpected unknown property "colr" (property-no-unknown)' },
        { line: 5, column: 6, rule: 'color-named', severity: 'error', text: 'Unexpected named color "red" (color-named)' },
      ],
    },
  ]);
  const [syn, unknown, named] = parseStylelint(json, path.resolve('/base'));
  assert.deepEqual(syn, { rule: 'syntax', severity: 'error', category: 'correctness', message: 'Unclosed block', location: { file: 's.css', line: 1, column: 2 } });
  assert.equal(unknown!.message, 'Unexpected unknown property "colr"');
  assert.equal(unknown!.severity, 'warning');
  assert.equal(named!.severity, 'info');
  assert.equal(named!.category, 'standards');
  assert.throws(() => parseStylelint('x', '/base'), { message: 'Stylelint returned output that is not JSON.' });
});

test('sourceFiles skips build folders and minified files', (t) => {
  const dir = tmp(t);
  for (const f of ['b.js', 'a.js', 'node_modules/x.js', 'vendor/x.js', 'build/x.js', 'dist/x.js', '.hidden/x.js', 'sub/c.min.js', 'sub/d.js', 'sub/e.css']) write(path.join(dir, f));
  assert.deepEqual(sourceFiles(dir, ['.js']).map((f) => path.relative(dir, f).split(path.sep).join('/')), ['a.js', 'b.js', 'sub/d.js']);
  assert.deepEqual(sourceFiles(path.join(dir, 'a.js'), ['.js']), []);
});

test('isGenerated spots built files', (t) => {
  const dir = tmp(t);
  assert.equal(isGenerated(write(path.join(dir, 'long.js'), `${'a'.repeat(600)}\n`)), true);
  assert.equal(isGenerated(write(path.join(dir, 'mapped.css'), '.a{}\n/*# sourceMappingURL=x.css.map */')), true);
  write(path.join(dir, 'sib.js.map'), '{}');
  assert.equal(isGenerated(write(path.join(dir, 'sib.js'), 'var a;\n')), true);
  assert.equal(isGenerated(write(path.join(dir, 'plain.js'), 'var a;\n')), false);
  assert.equal(isGenerated(path.join(dir, 'missing.js')), false);
});
