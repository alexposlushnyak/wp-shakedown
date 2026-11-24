import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { diffRuns } from '../src/diff.ts';
import { toHtml } from '../src/report/html.ts';
import { toJson } from '../src/report/json.ts';
import { toMarkdown } from '../src/report/markdown.ts';
import { toSarif } from '../src/report/sarif.ts';
import { defaultReportDir, readPreviousRun, writeReports } from '../src/report/write.ts';
import { detectTarget } from '../src/target.ts';
import { finding, makeTheme, result, tmp, write } from './helpers.ts';

test('markdown shows a finding with id, message, fix and docs', () => {
  const md = toMarkdown(result([finding({ id: 'abc123abc123', message: 'Bad thing', hint: 'Do this', docs: 'https://x.test/d' })]));
  assert.match(md, /^# wp-shakedown report\n/);
  assert.match(md, /1 error, 0 warnings, 0 notes\./);
  assert.match(md, /### a\.php\n\n- error `abc123abc123` line 3: Bad thing \(fake: r1\)\n  Fix: Do this\n  Docs: https:\/\/x\.test\/d/);
  assert.match(md, /## Run again/);
  assert.ok(md.endsWith('\n') && !md.endsWith('\n\n'));
});

test('markdown handles clean runs and runs with no engine', () => {
  assert.match(toMarkdown(result([])), /## Findings\n\nNo findings\./);
  const none = toMarkdown(result([], { engines: [], target: { kind: 'install', path: '/x', name: 'x', units: [] } }));
  assert.match(none, /No engine ran\. This version has no engine for a WordPress folder yet\./);
  assert.doesNotMatch(none, /Run again/);
});

test('markdown has diff, suppressed and stale sections', () => {
  const prev = result([finding({ id: 'old' })]);
  const cur = result([finding({ id: 'new' }), finding({ id: 'sup', suppressed: { reason: 'accepted' } })], { staleBaseline: ['gone'] });
  const md = toMarkdown(cur, diffRuns(prev, cur));
  assert.match(md, /## Since the last run\n\n1 fixed, 1 new, 0 still open\./);
  assert.match(md, /New:\n\n- a\.php: error `new`/);
  assert.match(md, /Fixed:\n\n- a\.php: error `old`/);
  assert.match(md, /## Suppressed\n\n- `sup` fake: r1\. Reason: accepted/);
  assert.match(md, /## Stale baseline entries\n\nThese baseline entries match nothing now\. Remove them\.\n\n- `gone`/);
  assert.match(md, /1 error, 0 warnings, 0 notes\. 1 suppressed\./);
});

test('markdown escapes pipes in cells and flattens newlines', () => {
  const r = result([finding({ message: 'one\ntwo' })], {
    engines: [{ engine: 'a|b', status: 'skipped', durationMs: 0, findings: 0, reason: 'x|y\nz' }],
  });
  const md = toMarkdown(r);
  assert.match(md, /\| a\\\|b \| - \| skipped: x\\\|y z \| 0 \|/);
  assert.match(md, /one two/);
});

test('html escapes dynamic values and only links http docs', () => {
  const html = toHtml(result([
    finding({ message: '<script>alert(1)</script>', docs: 'javascript:alert(1)' }),
    finding({ id: 'bbbbbbbbbbbb', docs: 'https://x.test/a?b=1&c=2' }),
  ]));
  assert.ok(html.startsWith('<!doctype html>'));
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /href="javascript/);
  assert.match(html, /<a href="https:\/\/x\.test\/a\?b=1&amp;c=2">/);
});

test('sarif has levels, rule ids, fingerprints and suppressions', () => {
  const s = JSON.parse(toSarif(result([
    finding({ id: 'e1', severity: 'error', location: { file: 'a.php', line: 2, column: 4 }, docs: 'https://d.test' }),
    finding({ id: 'w1', severity: 'warning', rule: 'r2', location: { url: 'http://x' } }),
    finding({ id: 'i1', severity: 'info', rule: 'r3', location: {}, suppressed: { reason: 'why' } }),
  ])));
  const run = s.runs[0];
  assert.equal(s.version, '2.1.0');
  assert.deepEqual(run.tool.driver.rules, [{ id: 'fake/r1', helpUri: 'https://d.test' }, { id: 'fake/r2' }, { id: 'fake/r3' }]);
  assert.deepEqual(run.results.map((r: { level: string }) => r.level), ['error', 'warning', 'note']);
  assert.equal(run.results[0].partialFingerprints['wpShakedown/v1'], 'e1');
  assert.deepEqual(run.results[0].locations[0].physicalLocation.region, { startLine: 2, startColumn: 4 });
  assert.equal(run.results[1].locations[0].physicalLocation.region, undefined);
  assert.equal(run.results[2].locations, undefined);
  assert.deepEqual(run.results[2].suppressions, [{ kind: 'external', justification: 'why' }]);
});

test('json round-trips', () => {
  const r = result([finding()]);
  assert.deepEqual(JSON.parse(toJson(r)), r);
});

test('writeReports writes four files and refuses a folder inside the target', (t) => {
  const target = detectTarget(makeTheme(tmp(t)));
  const r = result([finding()], { target: { kind: 'theme', path: target.path, name: 'T', units: [] } });
  const out = path.join(tmp(t), 'out');
  const files = writeReports(r, out);
  assert.deepEqual(files.map((f) => path.basename(f)), ['report.md', 'report.json', 'report.sarif', 'report.html']);
  assert.ok(files.every((f) => existsSync(f)));
  for (const bad of [target.path, path.join(target.path, 'out')]) {
    assert.throws(() => writeReports(r, bad), {
      message: `The report folder "${bad}" is inside the target. wp-shakedown never writes into what it tests. Pass --out with a folder elsewhere.`,
    });
  }
});

test('defaultReportDir is stable and outside the target', () => {
  const target = { kind: 'theme' as const, path: '/x/My Theme!', name: 'My Theme!', units: [] };
  const dir = defaultReportDir(target);
  assert.equal(dir, defaultReportDir(target));
  assert.match(path.relative(os.homedir(), dir), /^\.wp-shakedown[\\/]reports[\\/]my-theme-[0-9a-f]{8}$/);
  assert.match(defaultReportDir({ ...target, name: '***' }), /target-[0-9a-f]{8}$/);
});

test('readPreviousRun returns undefined for missing and broken files', (t) => {
  const dir = tmp(t);
  assert.equal(readPreviousRun(dir), undefined);
  write(path.join(dir, 'report.json'), 'nope');
  assert.equal(readPreviousRun(dir), undefined);
  write(path.join(dir, 'report.json'), '{"schema":2}');
  assert.equal(readPreviousRun(dir), undefined);
  mkdirSync(path.join(dir, 'sub'));
  const r = result([]);
  write(path.join(dir, 'sub', 'report.json'), toJson(r));
  assert.deepEqual(readPreviousRun(path.join(dir, 'sub')), r);
});

test('sarif encodes a space in a file path', () => {
  const sarif = JSON.parse(toSarif(result([finding({ location: { file: 'my theme/functions.php', line: 2 } })])));
  assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, 'my%20theme/functions.php');
});

test('readPreviousRun rejects a report without findings', (t) => {
  const dir = tmp(t);
  write(path.join(dir, 'report.json'), '{"schema":1}');
  assert.equal(readPreviousRun(dir), undefined);
});

test('html escapes a line value read from an old report', () => {
  const html = toHtml(result([finding({ location: { file: 'a.php', line: '<b>1</b>' as unknown as number } })]));
  assert.ok(!html.includes('<b>1</b>'));
});

test('markdown counts style findings per rule and does not list them', () => {
  const style = (id: string, rule: string) => finding({ id, rule, category: 'standards', severity: 'warning', message: `Style ${id}` });
  const md = toMarkdown(result([style('s1', 'Sp.A'), style('s2', 'Sp.A'), style('s3', 'Sp.B'), finding({ id: 'real', message: 'Real problem' })]));
  assert.ok(md.includes('Real problem'));
  assert.ok(!md.includes('Style s1'));
  assert.ok(md.includes('## Code style'));
  assert.ok(md.includes('3 style findings in 2 rules.'));
  assert.ok(md.indexOf('| fake: Sp.A | 2 |') < md.indexOf('| fake: Sp.B | 1 |'));
});

test('markdown says so when only style findings exist', () => {
  const md = toMarkdown(result([finding({ category: 'standards', severity: 'info' })]));
  assert.ok(md.includes('No findings apart from code style.'));
  assert.ok(md.includes('1 style finding in 1 rule.'));
});

test('the reports show the profile only when the run has one', () => {
  const withProfile = result([], { profile: 'wporg-theme' });
  assert.match(toMarkdown(withProfile), /- Target: .*\n- Profile: wporg-theme\n- Run: /);
  assert.match(toHtml(withProfile), /Profile: wporg-theme<br>\nRun: /);
  assert.doesNotMatch(toMarkdown(result([])), /Profile:/);
  assert.doesNotMatch(toHtml(result([])), /Profile:/);
});
