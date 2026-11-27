// Compares the hand-kept tool pins with their upstream versions.
// Usage: node scripts/tools-check.mjs [--write]
// Exit code: 0 all current, 1 something is behind, 2 a lookup failed.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const write = process.argv.includes('--write');
const root = new URL('..', import.meta.url);
const composerPath = new URL('php-tools/composer.json', root);
const wasmPath = new URL('php-wasm/package.json', root);
const composerText = readFileSync(composerPath, 'utf8');
const composer = JSON.parse(composerText);
const wasm = JSON.parse(readFileSync(wasmPath, 'utf8'));
const pkg = (name) => composer.repositories.find((r) => r.package?.name === name).package;

const headers = { 'user-agent': 'wp-shakedown-tools-check', accept: 'application/json' };
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
const getJson = async (url) => {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
};

const sources = [
  {
    tool: 'Theme Check',
    packages: ['theme-check/theme-check'],
    pinned: () => pkg('theme-check/theme-check').version,
    latest: async () => {
      const info = await getJson('https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request[slug]=theme-check');
      if (!info.version || !info.download_link) throw new Error('no version in the wordpress.org answer');
      return { id: info.version, url: info.download_link };
    },
    apply: async (latest) => {
      const p = pkg('theme-check/theme-check');
      const zip = await fetch(latest.url, { signal: AbortSignal.timeout(60_000) });
      if (!zip.ok) throw new Error(`${latest.url} answered ${zip.status}`);
      p.version = latest.id;
      p.dist.url = latest.url;
      if ('shasum' in p.dist) p.dist.shasum = createHash('sha1').update(Buffer.from(await zip.arrayBuffer())).digest('hex');
    },
  },
  {
    tool: 'Envato Theme Check',
    packages: ['envato/envato-theme-check'],
    pinned: () => pkg('envato/envato-theme-check').dist.reference,
    latest: async () => {
      const branch = pkg('envato/envato-theme-check').version.replace(/^dev-/, '');
      const sha = (await getJson(`https://api.github.com/repos/envato/envato-theme-check/commits/${branch}`)).sha;
      if (!sha) throw new Error('no commit in the GitHub answer');
      return { id: sha, url: `https://github.com/envato/envato-theme-check/archive/${sha}.zip` };
    },
    apply: async (latest) => {
      const p = pkg('envato/envato-theme-check');
      p.dist.url = latest.url;
      p.dist.reference = latest.id;
    },
    show: (v) => v.slice(0, 12),
  },
  {
    tool: 'Plugin Check sniffs',
    packages: ['plugin-check/phpcs-sniffs'],
    pinned: () => pkg('plugin-check/phpcs-sniffs').version,
    latest: async () => {
      const tag = (await getJson('https://api.github.com/repos/WordPress/plugin-check/releases/latest')).tag_name;
      if (!tag) throw new Error('no tag in the GitHub answer');
      return { id: tag.replace(/^v/, ''), url: `https://github.com/WordPress/plugin-check/archive/refs/tags/${tag}.zip` };
    },
    apply: async (latest) => {
      const p = pkg('plugin-check/phpcs-sniffs');
      p.version = latest.id;
      p.dist.url = latest.url;
      composer.require['plugin-check/phpcs-sniffs'] = latest.id;
    },
  },
  {
    tool: '@php-wasm/node',
    packages: [],
    pinned: () => wasm.dependencies['@php-wasm/node'],
    latest: async () => ({ id: (await getJson('https://registry.npmjs.org/@php-wasm/node/latest')).version }),
    apply: async (latest) => {
      // The two packages release together and keep one version.
      wasm.dependencies['@php-wasm/node'] = latest.id;
      wasm.dependencies['@php-wasm/universal'] = latest.id;
    },
  },
];

const rows = [];
const behind = [];
let failed = false;
for (const s of sources) {
  const pinned = s.pinned();
  try {
    const latest = await s.latest();
    const show = s.show ?? ((v) => v);
    const current = latest.id === pinned;
    rows.push([s.tool, show(pinned), show(latest.id), current ? 'current' : 'behind']);
    if (!current) behind.push({ s, latest });
  } catch (err) {
    failed = true;
    rows.push([s.tool, s.show ? s.show(pinned) : pinned, '?', 'lookup failed']);
    console.error(`${s.tool}: ${err.message}`);
  }
}

const head = ['tool', 'pinned', 'latest', 'status'];
const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
for (const r of [head, width.map((w) => '-'.repeat(w)), ...rows]) console.log(r.map((c, i) => c.padEnd(width[i])).join('  ').trimEnd());

if (write && behind.length) {
  console.log('');
  for (const { s, latest } of behind) {
    try {
      const before = s.pinned();
      await s.apply(latest);
      console.log(`${s.tool}: ${(s.show ?? ((v) => v))(before)} -> ${(s.show ?? ((v) => v))(latest.id)}`);
    } catch (err) {
      failed = true;
      console.error(`${s.tool}: not written. ${err.message}`);
    }
  }
  // Same two-space indent as the file, so the diff shows only the pins.
  writeFileSync(composerPath, JSON.stringify(composer, null, 2) + '\n');
  writeFileSync(wasmPath, JSON.stringify(wasm, null, 2) + '\n');
  const pkgs = behind.flatMap(({ s }) => s.packages);
  console.log('\nRefresh the locks:');
  if (pkgs.length) console.log(`  composer update --working-dir php-tools ${pkgs.join(' ')}`);
  if (behind.some(({ s }) => s.tool === '@php-wasm/node')) console.log('  npm install --prefix php-wasm');
}

process.exit(failed ? 2 : behind.length ? 1 : 0);
