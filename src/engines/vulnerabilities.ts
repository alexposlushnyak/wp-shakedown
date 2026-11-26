import { coreVersion, packages, skipOnNetwork } from '../health/install.ts';
import { getJson, Unreachable } from '../net.ts';
import type { Engine, RawFinding } from '../types.ts';
import { inRange } from '../versions.ts';

const HALF_DAY = 12 * 3600 * 1000;
const rec = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

const decode = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');

export interface WpvulnMatch {
  title: string;
  cves: string[];
  link?: string;
  fix?: string;
}

export function wpvulnMatches(data: unknown, version: string): WpvulnMatch[] {
  const out: WpvulnMatch[] = [];
  for (const raw of arr(rec(data)?.vulnerability)) {
    const v = rec(raw);
    if (!v) continue;
    const op = rec(v.operator);
    if (op && !inRange(version, { min: str(op.min_version) ?? null, minInclusive: op.min_operator === 'ge', max: str(op.max_version) ?? null, maxInclusive: op.max_operator === 'le' })) continue;
    const sources = arr(v.source).map(rec).filter((s): s is Record<string, unknown> => !!s);
    const isCve = (s: Record<string, unknown>) => String(s.id ?? '').startsWith('CVE-');
    const plain = sources.find((s) => !isCve(s));
    const first = sources.find(isCve) ?? sources[0];
    let fix: string | undefined;
    const max = str(op?.max_version);
    if (String(op?.unfixed) === '1') fix = 'No fixed version exists. Remove or replace it.';
    else if (op?.max_operator === 'lt' && max) fix = `Update to ${max} or newer.`;
    else if (op?.max_operator === 'le' && max) fix = `Update to a version newer than ${max}.`;
    const link = str(first?.link);
    out.push({
      title: decode(str(plain?.name) ?? str(v.name) ?? 'Known vulnerability'),
      cves: sources.filter(isCve).map((s) => String(s.id)),
      ...(link ? { link } : {}),
      ...(fix ? { fix } : {}),
    });
  }
  return out;
}

export interface Item {
  type: 'core' | 'plugin' | 'theme';
  slug: string;
  version: string;
}

export interface WordfenceMatch {
  title: string;
  cve?: string;
  link?: string;
  fix?: string;
  notice: string;
}

export function wordfenceMatches(feed: unknown, item: Item): WordfenceMatch[] {
  const out: WordfenceMatch[] = [];
  for (const raw of Object.values(rec(feed) ?? {})) {
    const r = rec(raw);
    if (!r || r.informational) continue;
    for (const sw of arr(r.software).map(rec)) {
      if (!sw || sw.type !== item.type || (item.type !== 'core' && sw.slug !== item.slug)) continue;
      const hit = Object.values(rec(sw.affected_versions) ?? {}).some((x) => {
        const a = rec(x);
        return !!a && inRange(item.version, { min: str(a.from_version) ?? null, minInclusive: !!a.from_inclusive, max: str(a.to_version) ?? null, maxInclusive: !!a.to_inclusive });
      });
      if (!hit) continue;
      const c = rec(r.copyrights);
      const notice = [rec(c?.defiant)?.notice, rec(c?.mitre)?.notice].filter((n): n is string => typeof n === 'string' && !!n).join(' ');
      const link = str(arr(r.references)[0]) ?? str(r.cve_link);
      const cve = str(r.cve);
      const fix = str(sw.remediation);
      out.push({ title: decode(str(r.title) ?? 'Known vulnerability'), ...(cve ? { cve } : {}), ...(link ? { link } : {}), ...(fix ? { fix } : {}), notice });
      break;
    }
  }
  return out;
}

export const vulnerabilities: Engine = {
  id: 'vulnerabilities',
  title: 'Known vulnerabilities',
  kinds: ['install'],
  level: 4,
  run({ target, signal, note }) {
    return skipOnNetwork(async () => {
      const o = { ttlMs: HALF_DAY, ...(signal ? { signal } : {}) };
      const items: (Item & { label: string; file: string })[] = [];
      const cv = coreVersion(target.path);
      if (cv) items.push({ type: 'core', slug: 'wordpress', version: cv.version, label: 'WordPress', file: 'wp-includes/version.php' });
      let unversioned = 0;
      for (const p of packages(target)) {
        if (p.version) items.push({ type: p.kind, slug: p.slug, version: p.version, label: p.name, file: p.file });
        else unversioned++;
      }
      if (unversioned) note(`${unversioned} ${unversioned === 1 ? 'package has' : 'packages have'} no version header and ${unversioned === 1 ? 'was' : 'were'} not looked up.`);

      let feed: unknown;
      const key = process.env.WP_SHAKEDOWN_WORDFENCE_KEY;
      if (key) {
        try {
          const r = await getJson('https://www.wordfence.com/api/intelligence/v3/vulnerabilities/production', { ...o, headers: { Authorization: `Bearer ${key}` } });
          if (r.status !== 200) throw new Unreachable('Cannot reach www.wordfence.com.');
          feed = r.data;
          note('Using Wordfence Intelligence next to WPVulnerability.');
        } catch (err) {
          if (!(err instanceof Unreachable)) throw err;
          note(`Wordfence Intelligence was not used: ${err.message}`);
        }
      }

      const out: RawFinding[] = [];
      for (const it of items) {
        if (signal?.aborted) break;
        const base = 'https://www.wpvulnerability.net';
        const url = it.type === 'core' ? `${base}/core/${it.version}/` : `${base}/${it.type}/${it.slug}/`;
        const r = await getJson(url, o);
        const a = r.status === 200 ? wpvulnMatches(rec(r.data)?.data, it.version) : [];
        const add = (title: string, docs?: string, hint?: string) =>
          out.push({
            rule: 'vulnerability', severity: 'error', category: 'security', message: `${it.label} ${it.version}: ${title}`,
            location: { file: it.file }, ...(docs ? { docs } : {}), ...(hint ? { hint } : {}),
          });
        for (const m of a) add(m.title, m.link, m.fix);
        if (feed) {
          const seen = new Set(a.flatMap((m) => m.cves));
          for (const m of wordfenceMatches(feed, it)) {
            if (m.cve && seen.has(m.cve)) continue;
            add(m.title, m.link, [m.fix, `Source: Wordfence Intelligence. ${m.notice}`.trim()].filter(Boolean).join(' '));
          }
        }
      }
      return out;
    });
  },
};
