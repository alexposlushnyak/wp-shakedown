import assert from 'node:assert/strict';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { addProject, findProject, listProjects, removeProject } from '../src/projects.ts';
import { runSession } from '../src/session.ts';
import { importZip } from '../src/uploads.ts';
import { makeTheme, tmp, zipOf } from './helpers.ts';

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

test('add lists a theme, and adding it again changes nothing', (t) => {
  home(t);
  const dir = makeTheme(tmp(t), 'Alpha');
  const first = addProject(dir);
  assert.equal(first.added, true);
  assert.equal(addProject(dir).added, false);
  const all = listProjects();
  assert.equal(all.length, 1);
  assert.equal(all[0]!.kind, 'theme');
  assert.equal(all[0]!.name, 'Alpha');
  assert.ok(!('last' in all[0]!));
});

test('findProject matches id, path and name, and refuses a shared name', (t) => {
  home(t);
  const a = addProject(makeTheme(tmp(t), 'Alpha')).project;
  addProject(makeTheme(tmp(t), 'Twin'));
  addProject(makeTheme(tmp(t), 'Twin'));
  assert.equal(findProject(a.id)?.path, a.path);
  assert.equal(findProject(a.path)?.id, a.id);
  assert.equal(findProject('ALPHA')?.id, a.id);
  assert.equal(findProject('twin'), undefined);
});

test('removeProject returns true, then false', (t) => {
  home(t);
  addProject(makeTheme(tmp(t), 'Alpha'));
  assert.equal(removeProject('alpha'), true);
  assert.equal(removeProject('alpha'), false);
  assert.deepEqual(listProjects(), []);
});

test('removeProject deletes the unpacked folder of a ZIP project and leaves other folders', (t) => {
  home(t);
  const theme = makeTheme(tmp(t), 'Alpha');
  const zipped = importZip(zipOf([{ name: 'beta/style.css', data: '/*\nTheme Name: Beta\n*/\n' }, { name: 'beta/index.php', data: '<?php\n' }]), 'beta.zip');
  addProject(theme);
  addProject(zipped);
  assert.equal(removeProject('beta'), true);
  assert.equal(removeProject('alpha'), true);
  assert.equal(existsSync(zipped), false);
  assert.equal(existsSync(theme), true);
});

test('a deleted folder shows a problem and no kind', (t) => {
  home(t);
  const dir = makeTheme(tmp(t), 'Alpha');
  addProject(dir);
  rmSync(dir, { recursive: true });
  const p = listProjects()[0]!;
  assert.ok(p.problem);
  assert.equal(p.kind, undefined);
});

test('a broken projects.json reads as an empty list', (t) => {
  const dir = home(t);
  writeFileSync(path.join(dir, 'projects.json'), '{ nope');
  assert.deepEqual(listProjects(), []);
});

test('a run gives the project its last result', async (t) => {
  home(t);
  const dir = makeTheme(tmp(t), 'Alpha');
  addProject(dir);
  const s = await runSession({ input: dir, engines: [] });
  const last = listProjects()[0]!.last;
  assert.ok(last);
  assert.deepEqual(last.summary, s.result.summary);
  assert.equal(last.dir, s.dir);
});
