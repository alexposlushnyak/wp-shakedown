import { fileURLToPath } from 'node:url';
import { exec, NotFound } from '../exec.ts';
import { EngineSkipped } from '../types.ts';
import type { Engine, RawFinding } from '../types.ts';

export interface HealthTest {
  test: string;
  status: string;
  label: string;
  description?: string;
}

// Resolves to the package root from both src/engines and dist/engines.
const script = fileURLToPath(new URL('../../php-tools/site-health.php', import.meta.url));

const DOCS = 'https://wordpress.org/documentation/article/site-health-screen/';

const text = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** A critical result is a warning and a recommendation is a note. Site Health rates a local copy of a site as strictly as a live one. */
export function toFindings(tests: HealthTest[]): RawFinding[] {
  const out: RawFinding[] = [];
  for (const t of tests) {
    if (t.status !== 'critical' && t.status !== 'recommended') continue;
    const hint = text(t.description ?? '');
    out.push({
      rule: t.test,
      severity: t.status === 'critical' ? 'warning' : 'info',
      category: 'health',
      message: text(t.label),
      location: {},
      ...(hint ? { hint: hint.length > 400 ? `${hint.slice(0, 397)}...` : hint } : {}),
      docs: DOCS,
    });
  }
  return out;
}

const lastLine = (s: string): string => s.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';

export const siteHealth: Engine = {
  id: 'site-health',
  title: 'Site Health',
  kinds: ['install'],
  level: 4,
  async run({ target, signal, note }) {
    const wp = process.env.WP_SHAKEDOWN_WP || 'wp';
    const args = [
      `--path=${target.path}`,
      // WordPress starts without plugins and themes, and without the cron that a page load can start.
      '--skip-plugins',
      '--skip-themes',
      '--skip-packages',
      '--no-color',
      '--exec=define( "DISABLE_WP_CRON", true );',
      'eval-file',
      script,
    ];
    let r;
    try {
      r = await exec(wp, args, signal ? { signal } : {});
    } catch (err) {
      if (err instanceof NotFound) {
        throw new EngineSkipped('WP-CLI is not installed. Put wp on your PATH or set WP_SHAKEDOWN_WP to its path. It runs the Site Health tests of WordPress.');
      }
      throw err;
    }
    if (r.code !== 0) {
      const all = `${r.stderr}\n${r.stdout}`;
      if (/error establishing a database connection/i.test(all)) {
        throw new EngineSkipped('WordPress could not reach its database. The Site Health tests need the database of the site to run.');
      }
      if (/wp-config\.php'? not found/i.test(all)) throw new EngineSkipped('The folder has no wp-config.php, so WordPress cannot start.');
      if (/does not seem to be a WordPress install/i.test(all)) throw new EngineSkipped('WP-CLI does not find a WordPress it can start in this folder.');
      throw new Error(`WP-CLI stopped: ${lastLine(r.stderr).replace(/^Error: /, '') || `it exited with code ${r.code}.`}`);
    }
    // A plugin or a notice can print before the JSON, so read from where it starts.
    const at = r.stdout.lastIndexOf('{"wordpress"');
    let data: { tests?: unknown };
    try {
      data = JSON.parse(at >= 0 ? r.stdout.slice(at) : r.stdout);
    } catch {
      throw new Error('WP-CLI returned output that is not JSON.');
    }
    if (!data || !Array.isArray(data.tests)) throw new Error('WP-CLI returned output that is not JSON.');
    for (const t of data.tests as HealthTest[]) {
      if (t.status === 'error') note(`The Site Health test ${t.test} could not run: ${text(t.label)}`);
    }
    return toFindings(data.tests as HealthTest[]);
  },
};
