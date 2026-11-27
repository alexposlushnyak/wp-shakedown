import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { diffRuns } from '../src/diff.ts';
import { toHtml } from '../src/report/html.ts';
import { toJson } from '../src/report/json.ts';
import { toCsv } from '../src/report/csv.ts';
import { byRule, splitRepeated } from '../src/report/group.ts';
import { runLabel, summaryLine, toMarkdown } from '../src/report/markdown.ts';
import { toShort } from '../src/report/short.ts';
import { toSarif } from '../src/report/sarif.ts';
import { defaultReportDir, readPreviousRun, writeReports } from '../src/report/write.ts';
import { detectTarget } from '../src/target.ts';
import { finding, makeTheme, result, tmp, write } from './helpers.ts';

test('markdown shows a finding with id, message, fix and docs', () => {
  const md = toMarkdown(result([finding({ id: 'abc123abc123', message: 'Bad thing', hint: 'Do this', docs: 'https://x.test/d' })]));
  assert.match(md, /^# wp-shakedown report\n/);
  assert.match(md, /1 critical, 0 important, 0 recommended\./);
  assert.match(md, /### a\.php\n\n- Critical `abc123abc123` line 3: Bad thing \(fake: r1\)\n  Fix: Do this\n  Docs: https:\/\/x\.test\/d/);
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
  assert.match(md, /New:\n\n- a\.php: Critical `new`/);
  assert.match(md, /Fixed:\n\n- a\.php: Critical `old`/);
  assert.match(md, /## Suppressed\n\n- `sup` fake: r1\. Reason: accepted/);
  assert.match(md, /## Stale baseline entries\n\nThese baseline entries match nothing now\. Remove them\.\n\n- `gone`/);
  assert.match(md, /1 critical, 0 important, 0 recommended\. 1 suppressed\./);
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

test('writeReports writes six files and refuses a folder inside the target', (t) => {
  const target = detectTarget(makeTheme(tmp(t)));
  const r = result([finding()], { target: { kind: 'theme', path: target.path, name: 'T', units: [] } });
  const out = path.join(tmp(t), 'out');
  const files = writeReports(r, out);
  assert.deepEqual(files.map((f) => path.basename(f)), ['report.md', 'report.json', 'report.sarif', 'report.html', 'report-short.md', 'report.csv']);
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

test('the reports show the preset only when the run has one', () => {
  const withPreset = result([], { preset: 'wporg-theme' });
  assert.match(toMarkdown(withPreset), /- Target: .*\n- Preset: wporg-theme\n- Level: 6 \(standard\)\n- Run: /);
  assert.match(toHtml(withPreset), /Level 6 \(standard\), Preset wporg-theme, Run /);
  assert.doesNotMatch(toMarkdown(result([])), /Preset:/);
  assert.doesNotMatch(toHtml(result([])), /Preset:/);
});

test('the reports show the level, with its name where it has one', () => {
  const seven = result([], { level: 7 });
  assert.match(toMarkdown(seven), /- Target: .*\n- Level: 7\n- Run: /);
  assert.match(toHtml(seven), /Level 7, Run /);
  assert.match(toMarkdown(result([], { level: 3 })), /- Level: 3 \(quick\)\n/);
  assert.match(toMarkdown(result([], { level: 8 })), /- Level: 8 \(deep\)\n/);
  assert.match(toMarkdown(result([])), /- Level: 6 \(standard\)\n/);
});

test('the reports name the severities', () => {
  const r = result([finding({ id: 'e1', severity: 'error' }), finding({ id: 'w1', severity: 'warning' }), finding({ id: 'i1', severity: 'info' })]);
  const md = toMarkdown(r);
  assert.match(md, /- Critical `e1`/);
  assert.match(md, /- Important `w1`/);
  assert.match(md, /- Recommended `i1`/);
  const html = toHtml(r);
  for (const name of ['Critical', 'Important', 'Recommended']) assert.ok(html.includes(`>${name}</span>`), name);
  assert.match(toJson(r), /"severity": "error"/);
});

test('the summary line names the severities', () => {
  const r = result([finding({ severity: 'error' }), finding({ id: 'b', severity: 'warning' }), finding({ id: 'c', severity: 'warning' })]);
  assert.equal(summaryLine(r), '1 critical, 2 important, 0 recommended.');
  assert.equal(summaryLine(result([finding({ suppressed: { reason: 'x' } })])), '0 critical, 0 important, 0 recommended. 1 suppressed.');
});

test('a report written before levels reads back with level and preset', (t) => {
  const dir = tmp(t);
  const old = (extra: object) => {
    const { level: _level, ...rest } = result([]);
    write(path.join(dir, 'report.json'), JSON.stringify({ ...rest, ...extra }));
    return readPreviousRun(dir)!;
  };
  assert.equal(old({ depth: 'quick' }).level, 3);
  assert.equal(old({ depth: 'standard' }).level, 6);
  assert.equal(old({ depth: 'deep' }).level, 8);
  assert.equal(old({}).level, 6);
  const withProfile = old({ depth: 'deep', profile: 'envato' });
  assert.equal(withProfile.preset, 'envato');
  assert.ok(!('profile' in withProfile) && !('depth' in withProfile));
});

test('the reports show experimental checks only when they were on', () => {
  const on = result([], { experimental: true });
  assert.match(toMarkdown(on), /- Target: .*\n- Level: 6 \(standard\)\n- Experimental checks: on\n- Run: /);
  assert.match(toHtml(on), /Experimental checks on, Run /);
  assert.doesNotMatch(toMarkdown(result([])), /Experimental/);
  assert.doesNotMatch(toHtml(result([])), /Experimental/);
});

const many = (n: number, over: Parameters<typeof finding>[0] = {}, files = n) =>
  Array.from({ length: n }, (_, i) => finding({ id: `m${over.rule ?? 'r1'}${i}`, location: { file: `f${i % files}.php`, line: i + 1 }, ...over }));

test('html opens with the target name and the three counts', () => {
  const html = toHtml(result([finding()]));
  assert.match(html, /<h1>Fixture Theme<\/h1>/);
  assert.match(html, /<span class="n error">1<\/span><span class="l">Critical<\/span>/);
  assert.match(html, /<title>wp-shakedown report: Fixture Theme<\/title>/);
  assert.match(html, /Run 2026-01-01 00:00 UTC/);
});

test('csv has a header and quotes commas, quotes and newlines', () => {
  const csv = toCsv(result([finding({ id: 'q1', message: 'a, "b"\nc', location: { file: 'a.php', line: 3 } })]));
  const [head, ...rest] = csv.split('\r\n');
  assert.equal(head, 'id,severity,category,engine,rule,file,line,column,url,message,hint,docs,suppressed');
  assert.ok(csv.includes('"a, ""b""\nc"'));
  assert.ok(rest.at(-1) === '' && csv.startsWith(head!));
  assert.match(csv, /^q1,Critical,[a-z]+,fake,r1,a\.php,3,,,/m);
});

test('csv guards a message that starts like a formula and keeps the suppression reason', () => {
  const csv = toCsv(result([finding({ message: '=HYPERLINK("x")', suppressed: { reason: 'ok' } })]));
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(csv.trimEnd().endsWith(',ok'));
});

test('byRule sorts by severity, then count, then name', () => {
  const groups = byRule([
    ...many(1, { rule: 'z', severity: 'info' }),
    ...many(2, { rule: 'b', severity: 'warning' }),
    ...many(1, { rule: 'a', severity: 'warning' }),
    ...many(1, { rule: 'c', severity: 'error' }),
    ...many(1, { rule: 'a2', severity: 'warning' }),
  ]);
  assert.deepEqual(groups.map((g) => g.rule), ['c', 'b', 'a', 'a2', 'z']);
  assert.equal(groups[1]!.files, 2);
});

test('splitRepeated needs three findings in two files', () => {
  assert.equal(splitRepeated(many(3, {}, 2)).repeated.length, 1);
  assert.equal(splitRepeated(many(5, {}, 1)).repeated.length, 0);
  assert.equal(splitRepeated(many(2, {}, 2)).repeated.length, 0);
  const mixed = [...many(3, {}, 3), finding({ id: 'solo', rule: 'other' })];
  assert.deepEqual(splitRepeated(mixed).rest.map((f) => f.id), ['solo']);
});

test('markdown prints a repeated rule once, with its fix once', () => {
  const md = toMarkdown(result(many(3, { hint: 'Escape it', docs: 'https://x.test/d' }, 3)));
  assert.equal(md.match(/### fake: r1/g)?.length, 1);
  assert.equal(md.match(/Fix: Escape it/g)?.length, 1);
  assert.match(md, /Critical\. 3 findings in 3 files\./);
  assert.match(md, /- f1\.php line 2: Something is wrong `mr11`/);
  assert.doesNotMatch(md, /### f0\.php/);
  assert.match(toHtml(result(many(3, { hint: 'Escape it' }, 3))), /<h3>fake: r1<\/h3>/);
});

test('markdown names the run the diff compares against', () => {
  const cur = result([finding()]);
  const d = diffRuns(result([]), cur);
  assert.match(toMarkdown(cur, d), /## Since the last run\n/);
  assert.match(toMarkdown(cur, d, '2026-11-27T10:41:55.000Z'), /## Since the run of 2026-11-27 10:41 UTC\n/);
  assert.match(toHtml(cur, d, '2026-11-27T10:41:55.000Z'), /Since the run of 2026-11-27 10:41 UTC/);
  assert.equal(runLabel('not a date'), 'not a date');
});

test('short report lists critical and important by rule and caps the places', () => {
  const r = result([
    ...many(7, { rule: 'xss', message: 'Unescaped output' }, 7),
    finding({ id: 'w', rule: 'nonce', severity: 'warning', message: 'No nonce', location: { file: 'b.php' } }),
    finding({ id: 'rec', rule: 'tip', severity: 'info', message: 'Recommended thing' }),
    finding({ id: 'st', rule: 'Sp', severity: 'info', category: 'standards', message: 'Style thing' }),
  ]);
  const md = toShort(r);
  assert.match(md, /^# wp-shakedown: Fixture Theme\n\ntheme at \/x\/theme, level 6 \(standard\)\nRun 2026-01-01 00:00 UTC, wp-shakedown 0\.0\.0\.\n/);
  assert.match(md, /- Critical fake: xss, 7 in 7 files\. Unescaped output\n  - f0\.php:1\n/);
  assert.match(md, /  - f4\.php:5\n  - and 2 more\n/);
  assert.match(md, /- Important fake: nonce, 1 in 1 file\. No nonce\n  - b\.php\n/);
  assert.ok(!md.includes('Recommended thing') && !md.includes('Style thing'));
  assert.ok(md.endsWith('1 recommended finding and 1 code style finding are in report.md.\n'));
  assert.match(toShort(result([])), /No critical or important findings\./);
});

test('a finding without a file does not count as a file', () => {
  const g = byRule([finding({ id: 'a', location: {} }), finding({ id: 'b', location: { file: 'a.php' } })])[0]!;
  assert.equal(g.files, 1);
});

test('short report gives each place its message when a rule has several, and skips empty places', () => {
  const r = result([
    finding({ id: 'a', rule: 'basic', message: 'No DOCTYPE', location: {} }),
    finding({ id: 'b', rule: 'basic', message: 'No wp_head', location: { file: 'header.php', line: 3 } }),
    finding({ id: 'c', rule: 'screenshot', message: 'No screenshot', location: {} }),
    finding({ id: 'd', rule: 'xss', category: 'standards', severity: 'warning', message: 'Style above recommended' }),
  ]);
  const md = toShort(r);
  assert.match(md, /- Critical fake: basic, 2 in 1 file\.\n  - No DOCTYPE\n  - header\.php:3: No wp_head\n/);
  assert.match(md, /- Critical fake: screenshot, 1\. No screenshot\n\n/);
  assert.ok(!md.includes('(no file)') && !md.includes('Style above recommended'));
});

test('writeReports puts report.md first', (t) => {
  const files = writeReports(result([finding()]), path.join(tmp(t), 'o'));
  assert.equal(files.length, 6);
  assert.equal(path.basename(files[0]!), 'report.md');
});
