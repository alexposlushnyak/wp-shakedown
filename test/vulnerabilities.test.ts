import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import './env.ts';
import { vulnerabilities, wordfenceMatches, wpvulnMatches } from '../src/engines/vulnerabilities.ts';
import { detectTarget } from '../src/target.ts';
import { fakeNet, tmp, write } from './helpers.ts';

const rec = (name: string, op: object | undefined, sources: object[] = []) => ({ name, ...(op ? { operator: op } : {}), source: sources });
const op = (o: object) => ({ min_version: null, min_operator: null, max_version: null, max_operator: null, unfixed: '0', ...o });

test('wpvulnMatches applies operators', () => {
  const data = {
    vulnerability: [
      rec('lt', op({ max_version: '2.0', max_operator: 'lt' })),
      rec('le', op({ max_version: '1.0', max_operator: 'le' })),
      rec('min', op({ min_version: '1.0', min_operator: 'gt', max_version: '3', max_operator: 'lt' })),
      rec('unfixed', op({ unfixed: '1', max_version: '9', max_operator: 'lt' })),
      rec('plain', undefined),
    ],
  };
  const m = wpvulnMatches(data, '1.0');
  assert.deepEqual(m.map((x) => x.title), ['lt', 'le', 'unfixed', 'plain']);
  assert.equal(m[0]!.fix, 'Update to 2.0 or newer.');
  assert.equal(m[1]!.fix, 'Update to a version newer than 1.0.');
  assert.equal(m[2]!.fix, 'No fixed version exists. Remove or replace it.');
  assert.equal(m[3]!.fix, undefined);
  assert.equal(wpvulnMatches(data, '1.5').some((x) => x.title === 'min'), true);
  assert.equal(wpvulnMatches({ vulnerability: null }, '1').length, 0);
});

test('wpvulnMatches reads sources and decodes entities', () => {
  const m = wpvulnMatches({ vulnerability: [rec('Fallback', undefined, [{ id: 'CVE-1', name: 'x', link: 'https://c' }, { id: 'WPVDB', name: 'A &lt;b&gt; &amp; &quot;c&quot; &#039;d&#039;', link: 'https://w' }])] }, '1');
  assert.deepEqual(m[0], { title: `A <b> & "c" 'd'`, cves: ['CVE-1'], link: 'https://c' });
});

const wf = (extra: object = {}) => ({
  id: 'u1', title: 'XSS', informational: false, cve: 'CVE-9', cve_link: 'https://cve', references: ['https://ref'],
  copyrights: { defiant: { notice: 'D.' }, mitre: { notice: 'M.' } },
  software: [{ type: 'plugin', slug: 'pl', affected_versions: { r: { from_version: '*', from_inclusive: true, to_version: '1.0', to_inclusive: true } }, patched: false, patched_versions: [], remediation: 'Update it.' }],
  ...extra,
});

test('wordfenceMatches checks type, slug and range', () => {
  const item = { type: 'plugin' as const, slug: 'pl', version: '1.0' };
  const m = wordfenceMatches({ a: wf() }, item);
  assert.deepEqual(m, [{ title: 'XSS', cve: 'CVE-9', link: 'https://ref', fix: 'Update it.', notice: 'D. M.' }]);
  assert.equal(wordfenceMatches({ a: wf() }, { ...item, version: '1.1' }).length, 0);
  assert.equal(wordfenceMatches({ a: wf({ informational: true }) }, item).length, 0);
  assert.equal(wordfenceMatches({ a: wf() }, { ...item, slug: 'other' }).length, 0);
  const core = wf({ software: [{ type: 'core', slug: 'wordpress', affected_versions: { r: { from_version: '6.0', from_inclusive: true, to_version: '6.9', to_inclusive: false } } }] });
  assert.equal(wordfenceMatches({ a: core }, { type: 'core', slug: 'x', version: '6.8' }).length, 1);
});

const WPV = 'https://www.wpvulnerability.net/plugin/pl/';
const FEED = 'https://www.wordfence.com/api/intelligence/v3/vulnerabilities/production';

function setup(t: Parameters<typeof tmp>[0], extra: [string, { status: number; body?: unknown }][] = []) {
  const dir = tmp(t);
  write(path.join(dir, 'wp-includes/version.php'), "<?php $wp_version = '6.8';\n");
  write(path.join(dir, 'wp-content/plugins/pl/pl.php'), '<?php\n/*\nPlugin Name: Pl\nVersion: 1.0\n*/\n');
  write(path.join(dir, 'wp-content/plugins/nover/nover.php'), '<?php\n/*\nPlugin Name: Nover\n*/\n');
  const a = { data: { vulnerability: [rec('Known bug', op({ max_version: '2', max_operator: 'lt' }), [{ id: 'CVE-9', name: 'n', link: 'https://c' }])] } };
  const routes = new Map<string, { status: number; body?: unknown }>([
    [WPV, { status: 200, body: a }],
    ['https://www.wpvulnerability.net/core/6.8/', { status: 200, body: { data: { vulnerability: null } } }],
    ...extra,
  ]);
  const calls = fakeNet(t, routes);
  const notes: string[] = [];
  const go = async () => ({ f: await vulnerabilities.run({ target: detectTarget(dir), level: 6, note: (m) => notes.push(m) }), notes });
  return { go, calls };
}

test('vulnerabilities: source A only', async (t) => {
  const { go, calls } = setup(t);
  const { f, notes } = await go();
  assert.equal(f.length, 1);
  assert.equal(f[0]!.message, 'Pl 1.0: Known bug');
  assert.equal(f[0]!.severity, 'error');
  assert.equal(f[0]!.hint, 'Update to 2 or newer.');
  assert.equal(f[0]!.docs, 'https://c');
  assert.deepEqual(notes, ['1 package has no version header and was not looked up.']);
  assert.ok(!calls.some((c) => c.url === FEED));
});

test('vulnerabilities: Wordfence adds one finding and drops a duplicate', async (t) => {
  process.env.WP_SHAKEDOWN_WORDFENCE_KEY = 'secret-key';
  t.after(() => delete process.env.WP_SHAKEDOWN_WORDFENCE_KEY);
  const { go, calls } = setup(t, [[FEED, { status: 200, body: { a: wf(), b: wf({ id: 'u2', title: 'SQLi', cve: 'CVE-10', references: [] }) } }]]);
  const { f, notes } = await go();
  assert.equal(f.length, 2);
  const w = f.find((x) => x.message.endsWith('SQLi'))!;
  assert.ok(w.hint!.includes('Source: Wordfence Intelligence.'));
  assert.equal(w.docs, 'https://cve');
  assert.ok(notes.includes('Using Wordfence Intelligence next to WPVulnerability.'));
  assert.equal((calls.find((c) => c.url === FEED)!.init!.headers as Record<string, string>).Authorization, 'Bearer secret-key');
  assert.ok(!JSON.stringify(f).includes('secret-key'));
});

test('vulnerabilities: a rejected Wordfence key keeps source A', async (t) => {
  process.env.WP_SHAKEDOWN_WORDFENCE_KEY = 'secret-key';
  t.after(() => delete process.env.WP_SHAKEDOWN_WORDFENCE_KEY);
  const { go } = setup(t, [[FEED, { status: 401 }]]);
  const { f, notes } = await go();
  assert.equal(f.length, 1);
  assert.ok(notes.some((n) => n.startsWith('Wordfence Intelligence was not used: ')));
});
