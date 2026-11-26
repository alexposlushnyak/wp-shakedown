import { coreVersion, packages, skipOnNetwork } from '../health/install.ts';
import { getJson } from '../net.ts';
import type { Engine, RawFinding } from '../types.ts';
import { compareVersions } from '../versions.ts';

const HALF_DAY = 12 * 3600 * 1000;
const rec = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined);

/** Whole days from a YYYY-MM-DD start of the text to now. Undefined when the text has no date. */
export function daysSince(dateText: string, now: Date): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateText);
  if (!m) return undefined;
  return Math.floor((now.getTime() - Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) / 86400000);
}

/** The latest WordPress version, or undefined when the service gives none. Throws Unreachable when it cannot be reached. */
export async function latestWordPress(signal?: AbortSignal): Promise<string | undefined> {
  const offers = rec((await getJson('https://api.wordpress.org/core/version-check/1.7/', { ttlMs: HALF_DAY, ...(signal ? { signal } : {}) })).data)?.offers;
  const latest = rec(Array.isArray(offers) ? offers[0] : undefined)?.version;
  return typeof latest === 'string' ? latest : undefined;
}

export const updates: Engine = {
  id: 'updates',
  title: 'Updates',
  kinds: ['install'],
  level: 4,
  run({ target, signal }) {
    return skipOnNetwork(async () => {
      const out: RawFinding[] = [];
      const o = { ttlMs: HALF_DAY, ...(signal ? { signal } : {}) };
      const cv = coreVersion(target.path);
      if (cv) {
        const offers = rec((await getJson('https://api.wordpress.org/core/version-check/1.7/', o)).data)?.offers;
        const latest = rec(Array.isArray(offers) ? offers[0] : undefined)?.version;
        if (typeof latest === 'string' && compareVersions(cv.version, latest) < 0) {
          out.push({
            rule: 'core.outdated', severity: 'warning', category: 'health',
            message: `WordPress ${cv.version} is installed. The current version is ${latest}.`, location: { file: 'wp-includes/version.php' },
          });
        }
      }
      const now = new Date();
      for (const pkg of packages(target)) {
        if (signal?.aborted) break;
        if (!pkg.version) continue;
        const { name, version, file } = pkg;
        const plugin = pkg.kind === 'plugin';
        const url = plugin
          ? `https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request%5Bslug%5D=${encodeURIComponent(pkg.slug)}&request%5Bfields%5D%5Bsections%5D=0`
          : `https://api.wordpress.org/themes/info/1.2/?action=theme_information&request%5Bslug%5D=${pkg.slug}`;
        const r = await getJson(url, o);
        const d = rec(r.data);
        if (r.status === 404) {
          if (plugin && d?.error === 'closed') {
            out.push({
              rule: 'plugin.closed', severity: 'warning', category: 'security', message: `wordpress.org closed ${name}.`,
              hint: 'A closed plugin gets no updates. Look for a replacement.', location: { file },
            });
          }
          continue;
        }
        if (typeof d?.version === 'string' && compareVersions(version, d.version) < 0) {
          out.push({
            rule: `${pkg.kind}.outdated`, severity: 'warning', category: 'health',
            message: `${name} ${version} is installed. The current version is ${d.version}.`, location: { file },
          });
        }
        const days = typeof d?.last_updated === 'string' ? daysSince(d.last_updated, now) : undefined;
        if (days !== undefined && days > 730) {
          out.push({
            rule: `${pkg.kind}.abandoned`, severity: 'warning', category: 'health',
            message: `${name} had its last release on ${(d!.last_updated as string).slice(0, 10)}.`,
            hint: `A ${pkg.kind} with no release in two years may be abandoned.`, location: { file },
          });
        }
      }
      return out;
    });
  },
};
