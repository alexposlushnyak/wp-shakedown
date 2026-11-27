import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { test } from '@playwright/test';
import type { Page } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** A ZIP with the given files, deflated. Enough of the format for the upload route. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [file, text] of Object.entries(files)) {
    const name = Buffer.from(file);
    const data = Buffer.from(text);
    const body = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export interface App {
  url: string;
  /** The theme folders that were copied from the fixtures. */
  alpha: string;
  beta: string;
  /** A ZIP of a third theme. */
  zip: string;
}

/**
 * Starts `wp-shakedown ui` for the spec file: a fresh home with the E2E preset, the fixture themes, and a ZIP.
 * Returns a holder that is filled in before the first test and cleared after the last.
 */
export function useApp(): App {
  const app = {} as App;
  let child: ChildProcess | undefined;
  let dir = '';

  test.beforeAll(async () => {
    if (!existsSync(path.join(root, 'ui', 'dist', 'index.html'))) throw new Error('Run npm run build first.');
    dir = mkdtempSync(path.join(os.tmpdir(), 'wps-e2e-'));
    const home = path.join(dir, 'home');
    mkdirSync(path.join(home, 'presets'), { recursive: true });
    writeFileSync(
      path.join(home, 'presets', 'e2e-fast.json'),
      JSON.stringify({ schema: 1, title: 'E2E fast', summary: 'Only the JSON checks.', kinds: ['theme'], engines: ['wp-json'], level: 1 }),
    );
    const work = path.join(dir, 'work');
    mkdirSync(work);
    for (const name of readdirSync(fixtures)) {
      if (statSync(path.join(fixtures, name)).isDirectory()) cpSync(path.join(fixtures, name), path.join(work, name), { recursive: true });
    }
    app.alpha = path.join(work, 'theme-alpha');
    app.beta = path.join(work, 'theme-beta');
    app.zip = path.join(dir, 'e2e-gamma.zip');
    writeFileSync(
      app.zip,
      zip({
        'e2e-gamma/style.css': '/*\nTheme Name: E2E Gamma\nVersion: 1.0.0\nText Domain: e2e-gamma\n*/\n',
        'e2e-gamma/theme.json': '{ "version": 3, "notAWordPressProperty": true }\n',
        'e2e-gamma/templates/index.html': '<!-- wp:paragraph --><p>Hello</p><!-- /wp:paragraph -->\n',
      }),
    );

    child = spawn(process.execPath, [path.join(root, 'src', 'cli.ts'), 'ui', work, '--port', '0', '--no-open'], {
      env: { ...process.env, WP_SHAKEDOWN_HOME: home },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const proc = child;
    app.url = await new Promise<string>((resolve, reject) => {
      let out = '';
      proc.stdout!.on('data', (chunk: Buffer) => {
        out += chunk;
        const m = /wp-shakedown is running at (\S+)/.exec(out);
        if (m) resolve(m[1]!);
      });
      proc.once('exit', (code) => reject(new Error(`wp-shakedown ui exited with code ${code} before it printed its address.`)));
    });
  });

  test.afterAll(async () => {
    const proc = child;
    if (proc && proc.exitCode === null) {
      const exited = new Promise((resolve) => proc.once('exit', resolve));
      proc.kill('SIGTERM');
      await exited;
    }
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  return app;
}

/** Opens the page. The level is 1, so a run without a preset still only reaches the cheap engines. */
export async function open(page: Page, app: App): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('level', '1'));
  await page.goto(app.url);
}

