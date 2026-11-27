import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { zipOf } from '../test/helpers.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));

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
      zipOf([
        { name: 'e2e-gamma/style.css', data: '/*\nTheme Name: E2E Gamma\nVersion: 1.0.0\nText Domain: e2e-gamma\n*/\n' },
        { name: 'e2e-gamma/theme.json', data: '{ "version": 3, "notAWordPressProperty": true }\n' },
        { name: 'e2e-gamma/templates/index.html', data: '<!-- wp:paragraph --><p>Hello</p><!-- /wp:paragraph -->\n' },
      ]),
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

