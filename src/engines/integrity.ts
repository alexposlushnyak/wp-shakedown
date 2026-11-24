import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { coreVersion, packages, skipOnNetwork } from '../health/install.ts';
import { getJson } from '../net.ts';
import { EngineSkipped } from '../types.ts';
import type { Engine, RawFinding } from '../types.ts';

const MONTH = 30 * 24 * 3600 * 1000;
const md5 = (file: string): string => createHash('md5').update(readFileSync(file)).digest('hex');
const rec = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined);

function walk(root: string, dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(path.join(root, dir), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(root, rel, out);
    else if (e.isFile() && e.name !== '.DS_Store') out.push(rel);
  }
}

export const integrity: Engine = {
  id: 'integrity',
  title: 'File integrity',
  kinds: ['install'],
  run({ target, signal, note }) {
    return skipOnNetwork(async () => {
      const root = target.path;
      const out: RawFinding[] = [];
      const cv = coreVersion(root);
      if (!cv) throw new EngineSkipped('Cannot read the WordPress version from wp-includes/version.php.');

      const url = (locale: string) => `https://api.wordpress.org/core/checksums/1.0/?version=${cv.version}&locale=${locale}`;
      let r = await getJson(url(cv.locale), { ttlMs: MONTH, ...(signal ? { signal } : {}) });
      let sums = rec(rec(r.data)?.checksums);
      if (!sums && cv.locale !== 'en_US') {
        r = await getJson(url('en_US'), { ttlMs: MONTH, ...(signal ? { signal } : {}) });
        sums = rec(rec(r.data)?.checksums);
      }
      if (!sums) {
        note(`wordpress.org has no checksums for WordPress ${cv.version}. Core files were not compared.`);
      } else {
        for (const [file, sum] of Object.entries(sums)) {
          if (file.startsWith('wp-content/')) continue;
          const abs = path.join(root, file);
          if (!existsSync(abs)) {
            out.push({ rule: 'core.missing', severity: 'warning', category: 'health', message: 'A WordPress core file is missing.', location: { file } });
          } else if (md5(abs) !== sum) {
            out.push({
              rule: 'core.modified', severity: 'error', category: 'security',
              message: 'This WordPress core file differs from the official release.',
              hint: 'Reinstall WordPress core, or compare the file with the official release.', location: { file },
            });
          }
        }
        const found: string[] = [];
        walk(root, 'wp-admin', found);
        walk(root, 'wp-includes', found);
        for (const file of found) {
          if (Object.hasOwn(sums, file)) continue;
          out.push({
            rule: 'core.unexpected', severity: 'warning', category: 'security', message: 'This file is not part of WordPress core.',
            hint: 'The core folders hold only core files. Find out what put it there.', location: { file },
          });
        }
      }

      let skipped = 0;
      for (const pkg of packages(target)) {
        if (signal?.aborted) break;
        if (pkg.kind !== 'plugin' || !pkg.version) continue;
        if (statSync(pkg.path).isFile()) continue;
        const pr = await getJson(`https://downloads.wordpress.org/plugin-checksums/${pkg.slug}/${pkg.version}.json`, { ttlMs: MONTH, ...(signal ? { signal } : {}) });
        const files = pr.status === 200 ? rec(rec(pr.data)?.files) : undefined;
        if (!files) {
          skipped++;
          continue;
        }
        for (const [rel, info] of Object.entries(files)) {
          const abs = path.join(pkg.path, rel);
          const file = path.relative(root, abs).split(path.sep).join('/');
          if (!existsSync(abs)) {
            out.push({ rule: 'plugin.missing', severity: 'warning', category: 'health', message: `A file of ${pkg.name} ${pkg.version} is missing.`, location: { file } });
            continue;
          }
          const want = rec(info)?.md5;
          const list = Array.isArray(want) ? want : [want];
          if (!list.includes(md5(abs))) {
            out.push({ rule: 'plugin.modified', severity: 'error', category: 'security', message: `This file differs from the wordpress.org release of ${pkg.name} ${pkg.version}.`, location: { file } });
          }
        }
      }
      if (skipped) note(`${skipped} ${skipped === 1 ? 'plugin has' : 'plugins have'} no checksums on wordpress.org and ${skipped === 1 ? 'was' : 'were'} not compared.`);
      return out;
    });
  },
};
