import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { resolveCommand } from '../src/command.ts';
import './env.ts';
import { tmp, write } from './helpers.ts';

test('resolveCommand runs the script of an npm .cmd shim with Node on Windows', (t) => {
  const dir = tmp(t);
  // The npm.cmd of Node first runs npm-prefix.js, then npm-cli.js.
  write(path.join(dir, 'npm.cmd'), '@ECHO off\r\nSET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"\r\nSET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"\r\n"%_prog%" "%NPM_CLI_JS%" %*\r\n');
  write(path.join(dir, 'claude.cmd'), '@IF EXIST "%dp0%\\node.exe" (\r\n  "%dp0%\\node.exe" "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n)\r\n');
  const win = { platform: 'win32' as const, path: dir };
  assert.deepEqual(resolveCommand('npm', ['ci'], win), [process.execPath, [path.join(dir, 'node_modules\\npm\\bin\\npm-cli.js'), 'ci']]);
  assert.deepEqual(resolveCommand('claude', ['-p'], win), [process.execPath, [path.join(dir, 'node_modules\\@anthropic-ai\\claude-code\\cli.js'), '-p']]);
});

test('resolveCommand leaves an .exe, a path, other systems and unknown commands alone', (t) => {
  const dir = tmp(t);
  write(path.join(dir, 'claude.exe'), '');
  write(path.join(dir, 'claude.cmd'), '"%~dp0\\x.js"');
  const win = { platform: 'win32' as const, path: dir };
  assert.deepEqual(resolveCommand('claude', ['-p'], win), ['claude', ['-p']]);
  assert.deepEqual(resolveCommand('C:\\bin\\npm', [], win), ['C:\\bin\\npm', []]);
  assert.deepEqual(resolveCommand('nothing', ['a'], win), ['nothing', ['a']]);
  assert.deepEqual(resolveCommand('npm', ['ci'], { platform: 'darwin', path: dir }), ['npm', ['ci']]);
});
