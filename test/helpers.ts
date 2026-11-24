import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import type { Engine, EngineRun, Finding, RawFinding, RunResult, Severity, TargetKind } from '../src/types.ts';

export function tmp(t: TestContext): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wps-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function write(file: string, text = ''): string {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

export function makeTheme(dir: string, name = 'Fixture Theme'): string {
  write(path.join(dir, 'style.css'), `/*\nTheme Name: ${name}\nVersion: 1.0\n*/\n`);
  write(path.join(dir, 'functions.php'), '<?php\n');
  return dir;
}

export function makePlugin(dir: string, name = 'Fixture Plugin'): string {
  write(path.join(dir, 'main.php'), `<?php\n/**\n * Plugin Name: ${name}\n */\n`);
  return dir;
}

/** An install with themes b and a, a folder plugin and a one-file plugin. */
export function makeInstall(dir: string): string {
  write(path.join(dir, 'wp-includes', 'version.php'), '<?php $wp_version = "6.8";\n');
  makeTheme(path.join(dir, 'wp-content', 'themes', 'b'), 'Bee');
  makeTheme(path.join(dir, 'wp-content', 'themes', 'a'), 'Ay');
  makePlugin(path.join(dir, 'wp-content', 'plugins', 'folder-plugin'), 'Folder Plugin');
  write(path.join(dir, 'wp-content', 'plugins', 'single.php'), '<?php\n/*\nPlugin Name: Single\n*/\n');
  write(path.join(dir, 'wp-content', 'plugins', 'index.php'), '<?php // Silence is golden.\n');
  return dir;
}

export function fakeEngine(id: string, kinds: TargetKind[], run: Engine['run']): Engine {
  return { id, title: id, kinds, run };
}

export function raw(over: Partial<RawFinding> = {}): RawFinding {
  return { rule: 'r1', severity: 'error', category: 'other', message: 'Something is wrong', location: { file: 'a.php', line: 3 }, ...over };
}

export function finding(over: Partial<Finding> = {}): Finding {
  return { ...raw(), id: 'aaaaaaaaaaaa', engine: 'fake', rerun: 'wp-shakedown run "/x" --engine fake', ...over };
}

export function result(findings: Finding[] = [], over: Partial<RunResult> = {}): RunResult {
  const summary = { error: 0, warning: 0, info: 0, suppressed: 0 };
  for (const f of findings) {
    if (f.suppressed) summary.suppressed++;
    else summary[f.severity as Severity]++;
  }
  const engines: EngineRun[] = [{ engine: 'fake', status: 'ok', durationMs: 1, findings: findings.length }];
  return {
    schema: 1,
    tool: { name: 'wp-shakedown', version: '0.0.0' },
    target: { kind: 'theme', path: '/x/theme', name: 'Fixture Theme', units: [] },
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    engines,
    findings,
    summary,
    staleBaseline: [],
    ...over,
  };
}

const SAMPLE = `<?php
/**
 * Plugin Name: Sample
 * Requires PHP: 7.4
 */

function sample_render( $title ) {
	echo $title;
	$r = match ( $title ) { 'a' => 1, default => 2 };
}

function sample_more() {
	$u = 'https://bit.ly/abc';
	undefined_function_call();
	return get_the_title( 'not-an-id', 1, 2 );
}
`;

export function makeSample(dir: string): string {
  write(path.join(dir, 'sample.php'), SAMPLE);
  write(path.join(dir, 'inc', 'broken.php'), '<?php\nfunction broken( {\n');
  write(path.join(dir, 'vendor', 'lib.php'), '<?php\nfunction vendored( {\n');
  return dir;
}
