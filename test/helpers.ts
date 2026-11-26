import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import type { TestContext } from 'node:test';
import { net } from '../src/net.ts';
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

export function makePlugin(dir: string, name = 'Fixture Plugin', version?: string): string {
  write(path.join(dir, 'main.php'), `<?php\n/**\n * Plugin Name: ${name}\n${version ? ` * Version: ${version}\n` : ''} */\n`);
  return dir;
}

/** An install with themes b and a, a folder plugin and a one-file plugin. */
export function makeInstall(dir: string): string {
  write(path.join(dir, 'wp-includes', 'version.php'), '<?php $wp_version = "6.8";\n');
  makeTheme(path.join(dir, 'wp-content', 'themes', 'b'), 'Bee');
  makeTheme(path.join(dir, 'wp-content', 'themes', 'a'), 'Ay');
  makePlugin(path.join(dir, 'wp-content', 'plugins', 'folder-plugin'), 'Folder Plugin', '2.1.0');
  write(path.join(dir, 'wp-content', 'plugins', 'single.php'), '<?php\n/*\nPlugin Name: Single\nVersion: 0.5\n*/\n');
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

export interface FakeCall {
  url: string;
  init?: RequestInit;
}

/** Replaces net.fetch with answers from a map and gives the test its own cache folder. Unknown URLs fail like a lost connection. */
export function fakeNet(t: TestContext, routes: Map<string, { status: number; body?: unknown }>): FakeCall[] {
  const calls: FakeCall[] = [];
  const oldFetch = net.fetch;
  const oldHome = process.env.WP_SHAKEDOWN_HOME;
  process.env.WP_SHAKEDOWN_HOME = tmp(t);
  net.fetch = async (url, init) => {
    calls.push({ url, ...(init ? { init } : {}) });
    const r = routes.get(url);
    if (!r) throw new Error(`No route for ${url}`);
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? null), { status: r.status });
  };
  t.after(() => {
    net.fetch = oldFetch;
    if (oldHome === undefined) delete process.env.WP_SHAKEDOWN_HOME;
    else process.env.WP_SHAKEDOWN_HOME = oldHome;
  });
  return calls;
}

export interface ZipEntry {
  name: string;
  data?: string | Buffer;
  method?: 0 | 8;
  dir?: boolean;
  /** Unix mode, stored in the high 16 bits of the external attributes. Use 0o120777 for a symlink. */
  mode?: number;
  /** General purpose flags. Bit 0 marks an encrypted entry. */
  flags?: number;
  badCrc?: boolean;
  /** Overrides the declared uncompressed size. */
  size?: number;
}

/** Builds a classic ZIP (no ZIP64): local headers, central directory, end record. */
export function zipOf(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.dir && !e.name.endsWith('/') ? `${e.name}/` : e.name);
    const data = Buffer.from(e.data ?? '');
    const method = e.method ?? 8;
    const body = method === 8 ? deflateRawSync(data) : data;
    const crc = e.badCrc ? (crc32(data) ^ 1) >>> 0 : crc32(data);
    const size = e.size ?? data.length;
    const flags = e.flags ?? 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((e.mode ?? 0) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
