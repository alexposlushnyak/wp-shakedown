import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { pickerCommand } from '../src/ui/picker.ts';
import { tmp, write } from './helpers.ts';

/** A PATH folder holding fake executables with these names. */
function bin(t: TestContext, ...names: string[]): NodeJS.ProcessEnv {
  const dir = tmp(t);
  for (const n of names) chmodSync(write(path.join(dir, n), '#!/bin/sh\n'), 0o755);
  return { DISPLAY: ':0', PATH: dir };
}

test('darwin uses osascript with the start folder last', () => {
  const c = pickerCommand('/Users/me/code', 'darwin', {})!;
  assert.equal(c.cmd, 'osascript');
  assert.equal(c.args.at(-1), '/Users/me/code');
  assert.equal(c.parse(0, '/Users/me/theme/\n', ''), '/Users/me/theme');
  assert.equal(c.parse(1, '', 'execution error: User canceled. (-128)'), null);
  assert.throws(() => c.parse(1, '', 'some other failure'), /folder dialog failed/);
  assert.throws(() => c.parse(2, '', ''), /exit code 2/);
});

test('win32 uses powershell and passes the start folder through the environment', () => {
  const c = pickerCommand('C:\\Users\\me', 'win32', {})!;
  assert.equal(c.cmd, 'powershell.exe');
  assert.equal(c.env?.WP_SHAKEDOWN_PICK_START, 'C:\\Users\\me');
  assert.ok(!c.args.some((a) => a.includes('C:\\Users\\me')));
  assert.equal(c.parse(0, 'C:\\themes\\a\r\n', ''), 'C:\\themes\\a');
  assert.equal(c.parse(0, '', ''), null);
  assert.throws(() => c.parse(1, '', 'boom'), /boom/);
});

test('linux without a display has no dialog', (t) => {
  assert.equal(pickerCommand('/home/me', 'linux', { PATH: bin(t, 'zenity').PATH }), undefined);
});

test('linux prefers zenity', (t) => {
  const c = pickerCommand('/home/me', 'linux', bin(t, 'zenity', 'kdialog'))!;
  assert.equal(c.cmd, 'zenity');
  assert.ok(c.args.includes('--directory'));
  assert.ok(c.args.includes(`--filename=/home/me${path.sep}`));
  assert.equal(c.parse(0, '/home/me/theme/\n', ''), '/home/me/theme');
  assert.equal(c.parse(1, '', ''), null);
});

test('linux falls back to kdialog, then to nothing', (t) => {
  assert.equal(pickerCommand('/home/me', 'linux', bin(t, 'kdialog'))!.cmd, 'kdialog');
  assert.equal(pickerCommand('/home/me', 'linux', bin(t))!, undefined);
  assert.equal(pickerCommand('/home/me', 'linux', { WAYLAND_DISPLAY: 'w', PATH: bin(t, 'zenity').PATH })!.cmd, 'zenity');
});
