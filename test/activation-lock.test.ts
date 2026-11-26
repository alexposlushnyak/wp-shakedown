import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import './env.ts';
import { activationLock, stripComments } from '../src/engines/activation-lock.ts';
import { engines } from '../src/engines/index.ts';
import { detectTarget } from '../src/target.ts';
import { makePlugin, tmp, write } from './helpers.ts';

async function lines(t: TestContext, php: string, name = 'inc.php'): Promise<number[]> {
  const dir = makePlugin(tmp(t));
  write(path.join(dir, name), php);
  const found = await activationLock.run({ target: detectTarget(dir), level: 7, note() {} });
  return found.map((f) => f.location.line!);
}

test('the engine is registered for themes and plugins at level 7', () => {
  assert.ok(engines.includes(activationLock));
  assert.equal(activationLock.level, 7);
  assert.deepEqual(activationLock.kinds, ['theme', 'plugin']);
});

test('reports an early return when the product is not activated', async (t) => {
  assert.deepEqual(await lines(t, "<?php\n\nif ( ! get_option( 'mytheme_license_key' ) ) {\n\treturn;\n}\n"), [3]);
});

test('reports feature files required inside an activation check', async (t) => {
  assert.deepEqual(await lines(t, "<?php\nif ( $theme->is_activated() ) {\n\trequire_once 'features.php';\n}\n"), [2]);
});

test('reports wp_die when the license is missing', async (t) => {
  assert.deepEqual(await lines(t, "<?php\nif ( empty( $purchase_code ) )\n\twp_die( 'No license' );\n"), [2]);
});

test('reports a feature hook added inside the license check', async (t) => {
  assert.deepEqual(await lines(t, "<?php\nif ( license_is_valid() ) {\n\tadd_action( 'init', 'mytheme_register_types' );\n}\n"), [2]);
});

test('reports elseif and an envato item id check', async (t) => {
  const php = "<?php\nif ( $a ) {\n} elseif ( envato_item_id() === 5 ) {\n\tadd_shortcode( 'x', 'y' );\n}\n";
  assert.deepEqual(await lines(t, php), [3]);
});

test('ignores a body that only shows a notice', async (t) => {
  const php = "<?php\nif ( ! $is_activated ) {\n\tadd_action( 'admin_notices', function () {\n\t\tif ( ! x() ) { return; }\n\t\techo 'Activate';\n\t} );\n\t$msg = 'Enter your license';\n}\n";
  assert.deepEqual(await lines(t, php), []);
});

test('ignores echo of license text, unrelated checks and comments', async (t) => {
  assert.deepEqual(await lines(t, "<?php\nif ( ! $license ) { echo 'Enter a license key'; }\n"), []);
  assert.deepEqual(await lines(t, "<?php\nif ( ! defined( 'ABSPATH' ) ) {\n\texit;\n}\n"), []);
  assert.deepEqual(await lines(t, "<?php\n// if ( $license ) { return; }\n/* if ( is_activated() ) { exit; } */\nif ( $a ) { return; }\n"), []);
});

test('ignores the activation redirect and a license file include', async (t) => {
  assert.deepEqual(await lines(t, "<?php\nif ( isset( $_GET['activated'] ) && is_admin() ) {\n\twp_safe_redirect( admin_url( 'themes.php?page=welcome' ) );\n\texit;\n}\n"), []);
  assert.deepEqual(await lines(t, "<?php\nif ( file_exists( __DIR__ . '/license.txt' ) ) {\n\tinclude __DIR__ . '/license.txt';\n}\n"), []);
});

test('reports a license status check that returns early', async (t) => {
  assert.deepEqual(await lines(t, "<?php\nif ( 'valid' !== get_option( 'acme_license_status' ) ) {\n\treturn;\n}\n"), [2]);
});

test('skips vendor and minified files', async (t) => {
  const php = "<?php\nif ( $license ) { return; }\n";
  assert.deepEqual(await lines(t, php, 'vendor/x.php'), []);
  assert.deepEqual(await lines(t, php, 'a.min.php'), []);
});

test('stripComments keeps line numbers and strings', () => {
  const out = stripComments("<?php\n/* a\nb */\n$u = 'http://x'; // c\n");
  assert.equal(out.split('\n').length, 5);
  assert.ok(out.includes("'http://x'"));
  assert.ok(!out.includes('// c'));
});
