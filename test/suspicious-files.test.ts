import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import './env.ts';
import { suspiciousFiles } from '../src/engines/suspicious-files.ts';
import { detectTarget } from '../src/target.ts';
import { makeInstall, tmp, write } from './helpers.ts';

const run = async (dir: string) => {
  const f = await suspiciousFiles.run({ target: detectTarget(dir), level: 6, note: () => {} });
  return f.map((x) => `${x.rule}:${x.location.file}`).sort();
};
const P = (dir: string, rel: string, body: string) => write(path.join(dir, rel), `<?php\n${body}\n`);
const site = (t: Parameters<typeof tmp>[0]) => makeInstall(tmp(t));

const snapshot = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(`${p}:${statSync(p).mtimeMs}:${readFileSync(p).length}`);
    }
  };
  walk(dir);
  return out.sort();
};

test('a clean site has no findings, base64_decode of an image is fine, and the engine writes nothing', async (t) => {
  const dir = site(t);
  P(dir, 'wp-content/plugins/folder-plugin/img.php', "$png = base64_decode( 'iVBORw0KGgo=' );\nreturn $png;");
  P(dir, 'wp-content/plugins/folder-plugin/vendor/autoload.php', "spl_autoload_register( function ( $c ) { require __DIR__ . '/x.php'; } );");
  P(dir, 'wp-content/plugins/folder-plugin/vendor/min.php', `$x = "${'a b '.repeat(3000)}";`);
  P(dir, 'wp-content/plugins/adminer/adminer.php', 'echo 1;');
  P(dir, 'wp-content/plugins/folder-plugin/icon.php', `$i = 'data:image/png;base64,${'A'.repeat(6000)}';`);
  for (const f of ['index.php', 'wp-login.php', 'wp-config.php']) P(dir, f, 'echo 1;');
  write(path.join(dir, 'wp-content/uploads/a.jpg'), 'JFIF binary');
  const before = snapshot(dir);
  assert.deepEqual(await run(dir), []);
  assert.deepEqual(snapshot(dir), before);
});

test('obfuscated-code', async (t) => {
  const dir = site(t);
  const bad = (n: string, body: string) => P(dir, `wp-content/plugins/folder-plugin/${n}.php`, body);
  bad('a', 'eval( gzinflate( base64_decode( $x ) ) );');
  bad('b', 'assert( $_POST["x"] );');
  bad('c', "preg_replace( '/a/e', 'x', $s );");
  bad('d', 'create_function( "", $_GET["c"] );');
  bad('e', '$f = chr(115).chr(121).chr(115).chr(116).chr(101).chr(109);');
  bad('f', '${"\\x47\\x4c\\x4f"} = 1;');
  bad('ok', "$a = base64_decode( 'x' ); eval( $code ); preg_replace( '/a/i', 'x', $s );");
  const got = await run(dir);
  assert.deepEqual(got, ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => `obfuscated-code:wp-content/plugins/folder-plugin/${n}.php`).sort());
});

test('remote-code', async (t) => {
  const dir = site(t);
  P(dir, 'wp-content/plugins/folder-plugin/a.php', "system( $_GET['c'] );");
  P(dir, 'wp-content/plugins/folder-plugin/b.php', "eval( stripslashes( $_POST['c'] ) );");
  P(dir, 'wp-content/plugins/folder-plugin/c.php', "include $_REQUEST['f'];");
  P(dir, 'wp-content/plugins/folder-plugin/d.php', "echo `ls {$_SERVER['HTTP_X']}`; $z = `$_GET[x]`;");
  P(dir, 'wp-content/plugins/folder-plugin/ok.php', "if ( isset( $_GET['x'] ) ) { include 'a.php'; }\n$wpdb->exec( 'x' ); $x = sanitize_text_field( $_GET['y'] );");
  const got = (await run(dir)).filter((x) => x.startsWith('remote-code'));
  assert.deepEqual(got, ['a', 'b', 'c', 'd'].map((n) => `remote-code:wp-content/plugins/folder-plugin/${n}.php`));
});

test('webshell-name', async (t) => {
  const dir = site(t);
  for (const n of ['wso.php', 'C99.php', 'b374k-2.3.php', 'alfa_v4.php', 'filesman.php']) P(dir, `wp-content/themes/a/${n}`, 'echo 1;');
  P(dir, 'wp-content/themes/a/adminer.php', 'echo 1;');
  P(dir, 'wp-content/plugins/folder-plugin/adminer.php', 'echo 1;');
  P(dir, 'wp-content/themes/a/alfabet.php', 'echo 1;');
  P(dir, 'adminer.php', 'echo 1;');
  const got = (await run(dir)).filter((x) => x.startsWith('webshell-name'));
  assert.deepEqual(got, ['C99.php', 'alfa_v4.php', 'adminer.php', 'b374k-2.3.php', 'filesman.php', 'wso.php'].map((n) => `webshell-name:wp-content/themes/a/${n}`).sort());
});

test('hidden-php', async (t) => {
  const dir = site(t);
  P(dir, 'wp-content/themes/a/.cache.php', 'echo 1;');
  write(path.join(dir, 'wp-content/uploads/2026/pic.jpg'), 'GIF89a\n<?php echo 1;');
  write(path.join(dir, 'wp-content/uploads/2026/x.php'), '<?php echo 1;');
  write(path.join(dir, 'wp-content/uploads/2026/clean.png'), 'PNG data');
  write(path.join(dir, 'wp-content/themes/a/readme.txt'), 'use <?php tags');
  assert.deepEqual((await run(dir)).filter((x) => x.startsWith('hidden-php')), ['hidden-php:wp-content/themes/a/.cache.php', 'hidden-php:wp-content/uploads/2026/pic.jpg']);
});

test('long-encoded-string', async (t) => {
  const dir = site(t);
  const b64 = 'QUJD'.repeat(1500);
  P(dir, 'wp-content/plugins/folder-plugin/a.php', `$p = "${b64}";`);
  P(dir, 'wp-content/plugins/folder-plugin/vendor/b.php', `$p = "${b64}";`);
  P(dir, 'wp-content/plugins/folder-plugin/c.php', `$p = "${'function a(){} '.repeat(500)}";`);
  assert.deepEqual((await run(dir)).filter((x) => x.startsWith('long-')), ['long-encoded-string:wp-content/plugins/folder-plugin/a.php']);
});

test('php-in-root', async (t) => {
  const dir = site(t);
  for (const n of ['wp-feed.php', 'shell.php', 'wp-cron.php', 'wp-config.php', 'xmlrpc.php']) P(dir, n, 'echo 1;');
  assert.deepEqual((await run(dir)).filter((x) => x.startsWith('php-in-root')), ['php-in-root:shell.php', 'php-in-root:wp-feed.php']);
});

test('findings carry severity, category, hint and a line', async (t) => {
  const dir = site(t);
  P(dir, 'wp-content/plugins/folder-plugin/a.php', '\n\neval( base64_decode( $x ) );');
  const f = await suspiciousFiles.run({ target: detectTarget(dir), level: 6, note: () => {} });
  assert.equal(f.length, 1);
  assert.equal(f[0]!.severity, 'error');
  assert.equal(f[0]!.category, 'security');
  assert.ok(f[0]!.hint);
  assert.equal(f[0]!.location.line, 4);
});

test('malware signatures in comments and strings of a security plugin are not reported', async (t) => {
  const dir = site(t);
  P(dir, 'wp-content/plugins/guard/rules.php', [
    "// Matches eval(base64_decode($x)) in uploaded files.",
    "$signatures = array( 'eval(base64_decode(', 'system($_GET[', \"assert(\\$_POST\" );",
    '/* exec($_REQUEST["c"]) is what shells do */',
  ].join('\n'));
  assert.deepEqual(await run(dir), []);
  // The same calls as code are reported.
  P(dir, 'wp-content/plugins/guard/shell.php', 'eval(base64_decode($_POST["p"]));');
  assert.deepEqual(await run(dir), ['obfuscated-code:wp-content/plugins/guard/shell.php', 'remote-code:wp-content/plugins/guard/shell.php']);
});
