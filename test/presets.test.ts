import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { engines } from '../src/engines/index.ts';
import { themeCheck } from '../src/engines/theme-check.ts';
import { builtInPresets, findPreset, listPresets, presetEngines, presetTable, removePreset, savePreset } from '../src/presets.ts';
import { runSession } from '../src/session.ts';
import { detectTarget } from '../src/target.ts';
import type { Preset } from '../src/types.ts';
import { fakeEngine, makePlugin, makeTheme, tmp, write } from './helpers.ts';

/** Points the home folder at an empty one for the test. */
function home(t: TestContext): string {
  const dir = tmp(t);
  const old = process.env.WP_SHAKEDOWN_HOME;
  process.env.WP_SHAKEDOWN_HOME = dir;
  t.after(() => {
    if (old === undefined) delete process.env.WP_SHAKEDOWN_HOME;
    else process.env.WP_SHAKEDOWN_HOME = old;
  });
  return dir;
}

const mine = (over: Partial<Preset> = {}): Preset => ({ id: 'mine', title: 'Mine', summary: 'My own gate.', kinds: ['theme'], engines: ['php-lint', 'wpcs'], level: 7, failOn: 'warning', ...over });
const known = engines.map((e) => e.id);

test('every engine of a built-in preset exists', () => {
  for (const p of builtInPresets) for (const id of p.engines) assert.ok(known.includes(id), `${p.id} names ${id}`);
});

test('the built-in presets have the levels of the plan', () => {
  const levels = Object.fromEntries(builtInPresets.map((p) => [p.id, p.level]));
  assert.deepEqual(levels, { 'wporg-theme': 7, envato: 7, 'wporg-plugin': 7, client: 8, site: 6 });
  const client = builtInPresets.find((p) => p.id === 'client')!;
  assert.equal(client.title, 'Client or commercial project');
  assert.deepEqual(client.kinds, ['theme', 'plugin']);
  assert.deepEqual(client.engines, ['php-lint', 'wp-json', 'review', 'wpcs', 'php-compat', 'phpstan', 'eslint', 'stylelint']);
});

test('presetEngines returns the known engines and rejects a wrong preset', (t) => {
  home(t);
  const theme = detectTarget(makeTheme(tmp(t)));
  const wporg = builtInPresets.find((p) => p.id === 'wporg-theme')!;
  // An engine that does not exist yet is dropped without an error.
  assert.deepEqual(presetEngines('wporg-theme', theme, ['php-lint', 'wpcs']), ['php-lint', 'wpcs']);
  assert.deepEqual(presetEngines('wporg-theme', theme, [...wporg.engines]), wporg.engines);
  assert.throws(() => presetEngines('x', theme, known), /Unknown preset "x"/);
  const plugin = detectTarget(makePlugin(tmp(t), 'My Plugin'));
  assert.throws(() => presetEngines('wporg-theme', plugin, known), /checks a theme. "My Plugin" is a plugin/);
});

test('a user preset is a file in the home folder', (t) => {
  const dir = home(t);
  savePreset(mine());
  assert.ok(existsSync(path.join(dir, 'presets', 'mine.json')));
  const { presets, problems } = listPresets();
  assert.deepEqual(problems, []);
  assert.deepEqual(presets.map((p) => p.id), [...builtInPresets.map((p) => p.id), 'mine']);
  assert.deepEqual(findPreset('mine'), mine());
  assert.ok(!('builtIn' in findPreset('mine')!));
  assert.equal(findPreset('envato')!.builtIn, true);
  const theme = detectTarget(makeTheme(tmp(t)));
  // Engine IDs no engine has are ignored.
  savePreset(mine({ engines: ['php-lint', 'nothing-here'] }));
  assert.deepEqual(presetEngines('mine', theme, known), ['php-lint']);
  assert.equal(removePreset('mine'), true);
  assert.equal(removePreset('mine'), false);
  assert.equal(findPreset('mine'), undefined);
});

test('user presets come after the built-in ones, sorted by ID', (t) => {
  home(t);
  savePreset(mine({ id: 'zed' }));
  savePreset(mine({ id: 'abc' }));
  assert.deepEqual(listPresets().presets.slice(builtInPresets.length).map((p) => p.id), ['abc', 'zed']);
});

test('a file that is not a valid preset is a problem, and breaks only a run that asks for it', (t) => {
  const dir = home(t);
  savePreset(mine());
  const file = (n: string, text: string) => write(path.join(dir, 'presets', n), text);
  const valid = { schema: 1, title: 'T', summary: 'S', kinds: ['theme'], engines: ['php-lint'] };
  file('notjson.json', '{ nope');
  file('extra.json', JSON.stringify({ ...valid, colour: 'red' }));
  file('nokinds.json', JSON.stringify({ ...valid, kinds: [] }));
  file('badlevel.json', JSON.stringify({ ...valid, level: 11 }));
  file('badfail.json', JSON.stringify({ ...valid, failOn: 'critical' }));
  file('envato.json', JSON.stringify(valid));
  file('Bad_Name.json', JSON.stringify(valid));
  const { presets, problems } = listPresets();
  assert.ok(presets.some((p) => p.id === 'mine'));
  assert.deepEqual(problems.map((p) => path.basename(p.file)).sort(), ['Bad_Name.json', 'badfail.json', 'badlevel.json', 'envato.json', 'extra.json', 'nokinds.json', 'notjson.json']);
  const why = (name: string) => problems.find((p) => path.basename(p.file) === name)!.error;
  assert.equal(why('notjson.json'), 'it is not JSON');
  assert.match(why('extra.json'), /a field the format does not know, "colour"/);
  assert.match(why('envato.json'), /built-in preset/);
  assert.match(why('Bad_Name.json'), /lowercase letters/);
  const theme = detectTarget(makeTheme(tmp(t)));
  assert.deepEqual(presetEngines('mine', theme, known), ['php-lint', 'wpcs']);
  assert.throws(() => presetEngines('extra', theme, known), /preset file .*extra\.json is not valid: it has a field/);
});

test('savePreset refuses a built-in ID and an invalid preset', (t) => {
  const dir = home(t);
  assert.throws(() => savePreset(mine({ id: 'envato' })), /built-in preset/);
  assert.throws(() => savePreset(mine({ id: 'Not Valid' })), /lowercase letters/);
  assert.throws(() => savePreset(mine({ id: '-x' })), /lowercase letters/);
  assert.throws(() => savePreset(mine({ level: 12 })), /level/);
  assert.throws(() => savePreset(mine({ engines: [] })), /engines/);
  assert.throws(() => savePreset(mine({ kinds: ['url'] })), /kinds/);
  assert.equal(existsSync(path.join(dir, 'presets')), false);
  assert.throws(() => removePreset('site'), /built-in preset and cannot be removed/);
});

test('a preset can leave level and failOn out', (t) => {
  home(t);
  const { level: _l, failOn: _f, ...bare } = mine();
  savePreset(bare);
  assert.deepEqual(findPreset('mine'), bare);
});

test('presetTable lists id, title, kinds, level, engine count and source', (t) => {
  const dir = home(t);
  savePreset(mine());
  const lines = presetTable(listPresets().presets).split('\n');
  assert.match(lines[0]!, /^ID +Title +Kinds +Level +Engines +Source$/);
  assert.match(lines.find((l) => l.startsWith('client'))!, /^client +Client or commercial project +theme, plugin +8 +8 +built-in$/);
  assert.match(lines.find((l) => l.startsWith('mine'))!, new RegExp(`^mine +Mine +theme +7 +2 +${path.join(dir, 'presets', 'mine.json').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
});

test('a session takes the level of its preset unless it is given one, and accepts profile as the old name', async (t) => {
  home(t);
  const dir = makeTheme(tmp(t));
  const seen: number[] = [];
  const probe = (id: string, level: number) => fakeEngine(id, ['theme'], async (ctx) => (seen.push(ctx.level), []), level);
  const engines = [probe('php-lint', 0), probe('wpcs', 5), probe('phpstan', 8)];
  savePreset(mine({ engines: ['php-lint', 'wpcs', 'phpstan'], level: 5 }));
  const out = () => path.join(tmp(t), 'out');
  const a = await runSession({ input: dir, preset: 'mine', engines, out: out() });
  assert.equal(a.result.level, 5);
  assert.equal(a.result.preset, 'mine');
  assert.deepEqual(a.result.engines.map((e) => e.engine), ['php-lint', 'wpcs']);
  const b = await runSession({ input: dir, preset: 'mine', level: 8, engines, out: out() });
  assert.equal(b.result.level, 8);
  assert.deepEqual(b.result.engines.map((e) => e.engine), ['php-lint', 'wpcs', 'phpstan']);
  const c = await runSession({ input: dir, profile: 'mine', engines, out: out() });
  assert.equal(c.result.preset, 'mine');
  await assert.rejects(runSession({ input: dir, preset: 'mine', only: ['wpcs'], engines, out: out() }), /Use a preset or a list of engines, not both\./);
});

test('the built-in presets name their directory and the site preset runs install engines only', () => {
  const dirs = Object.fromEntries(builtInPresets.map((p) => [p.id, p.directory]));
  assert.deepEqual(dirs, { 'wporg-theme': 'wporg', envato: 'envato', 'wporg-plugin': 'wporg', client: undefined, site: undefined });
  const site = builtInPresets.find((p) => p.id === 'site')!;
  assert.deepEqual(site.engines, ['integrity', 'updates', 'vulnerabilities', 'config', 'site-health', 'suspicious-files']);
  for (const id of site.engines) assert.ok(known.includes(id) && engines.find((e) => e.id === id)!.kinds.includes('install'), id);
  assert.equal(builtInPresets.find((p) => p.id === 'envato')!.engines.includes('review'), true);
});

test('the envato preset makes theme check run the Envato variant', () => {
  const dir = findPreset('envato')!.directory;
  assert.equal(themeCheck.variant!({ preset: 'envato', ...(dir ? { directory: dir } : {}), level: 7 }), 'envato');
  assert.equal(themeCheck.variant!({ directory: findPreset('wporg-theme')!.directory!, level: 7 }), undefined);
});

test('an old preset file with themeCheck reads as directory envato', (t) => {
  home(t);
  const file = path.join(home(t), 'presets', 'old.json');
  write(file, JSON.stringify({ schema: 1, title: 'Old', summary: 'Old file.', kinds: ['theme'], engines: ['php-lint'], themeCheck: 'envato' }));
  assert.equal(findPreset('old')!.directory, 'envato');
  assert.ok(!('themeCheck' in findPreset('old')!));
});

test("a copy of the envato preset keeps Envato's Theme Check", (t) => {
  home(t);
  const { builtIn: _, ...envato } = findPreset('envato')!;
  savePreset({ ...envato, id: 'my-envato', title: 'My ThemeForest' });
  assert.equal(findPreset('my-envato')!.directory, 'envato');
  assert.equal(findPreset('wporg-theme')!.directory, 'wporg');
});
