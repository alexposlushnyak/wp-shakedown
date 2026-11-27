import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import './env.ts';
import { engines } from '../src/engines/index.ts';
import { loadSubject, review, ruleApplies, rules, visibleTexts } from '../src/engines/review.ts';
import { stripComments } from '../src/php/source.ts';
import { run } from '../src/runner.ts';
import { detectTarget } from '../src/target.ts';
import type { RawFinding } from '../src/types.ts';
import { fakeNet, makePlugin, makeTheme, tmp, write } from './helpers.ts';

const STYLE = '/*\nTheme Name: Acme Theme\nAuthor: Jane Doe\nVersion: 1.0\n*/\n';

/** Writes a theme. `style.css` gets a default header unless the files give one. */
function theme(t: TestContext, files: Record<string, string> = {}): string {
  const dir = tmp(t);
  for (const [f, text] of Object.entries({ 'style.css': STYLE, ...files })) write(path.join(dir, f), text);
  return dir;
}

async function check(dir: string, id: string, notes: string[] = []): Promise<RawFinding[]> {
  const target = detectTarget(dir);
  return rules[id]!.run(loadSubject({ target, level: 6, note: (m) => notes.push(m) }));
}

const messages = (f: RawFinding[]): string[] => f.map((x) => x.message);
const CORE = 'https://api.wordpress.org/core/version-check/1.7/';

test('visibleTexts skips PHP, comments, script and style and keeps line numbers', () => {
  const src = '<?php\necho "x";\n?>\n<!-- Hidden words -->\n<script>var a = "Some words";</script>\n<style>.a > b { color: red }</style>\n<p>Shown here</p>\n<img alt="Picture text" src="a.png">\n<p>&copy; 2024</p>';
  assert.deepEqual(visibleTexts(src, 'php'), [
    { line: 7, text: 'Shown here' },
    { line: 8, text: 'Picture text' },
  ]);
});

test('untranslated-text', async (t) => {
  const dir = theme(t, {
    'index.php': '<?php\n// one\n// two\n?>\n<h1>Hello world</h1>\n<?php esc_html_e( "Fine", "x" ); ?>\n<p><?php the_title(); ?></p>',
    'ok.php': '<?php echo "Words in PHP"; ?>\n<!-- Comment words -->\n<script>x("Script words")</script>',
  });
  const f = await check(dir, 'untranslated-text');
  assert.deepEqual(messages(f), ['The text "Hello world" is not passed through a translation function.']);
  assert.deepEqual(f[0]!.location, { file: 'index.php', line: 5 });
  assert.equal(f[0]!.severity, 'warning');
  assert.equal(f[0]!.category, 'i18n');
  const alt = theme(t, { 'a.php': '<img alt="A cat on a mat" src="x.png">' });
  assert.equal((await check(alt, 'untranslated-text'))[0]!.location.line, 1);
});

test('text-in-template', async (t) => {
  const block = theme(t, { 'templates/index.html': '<!-- wp:paragraph -->\n<p>Read more</p>\n<!-- /wp:paragraph -->', 'parts/footer.html': '<p>&copy; 2024</p>' });
  const f = await check(block, 'text-in-template');
  assert.deepEqual(messages(f), ['The text "Read more" sits in an HTML template, where it cannot be translated.']);
  assert.deepEqual([f[0]!.severity, f[0]!.category, f[0]!.location], ['info', 'i18n', { file: 'templates/index.html', line: 2 }]);
  const classic = theme(t, { 'templates/x.html': '<p>Read more</p>' });
  assert.deepEqual(await check(classic, 'text-in-template'), []);
});

test('readme-headers', async (t) => {
  const wrong = await check(theme(t, { 'README.md': 'x' }), 'readme-headers');
  assert.deepEqual(messages(wrong), ['The readme is named README.md. Name it readme.txt.']);
  assert.equal(wrong[0]!.location.file, 'README.md');
  assert.deepEqual(await check(theme(t), 'readme-headers'), []);

  const bare = await check(theme(t, { 'readme.txt': 'Acme\nContributors: jane\n' }), 'readme-headers');
  assert.equal(bare[0]!.message, 'readme.txt does not start with the theme name between === signs.');
  assert.equal(bare[0]!.location.line, 1);
  assert.ok(messages(bare).includes('readme.txt has no "Requires PHP:" line.'));
  assert.ok(messages(bare).includes('readme.txt has no Changelog section.'));
  assert.ok(!messages(bare).includes('readme.txt has no "Contributors:" line.'));

  const good = '=== Acme ===\nContributors: jane\nRequires at least: 6.4\nTested up to: 6.8\nRequires PHP: 7.4\nLicense: GPLv2\nLicense URI: x\n\n== Changelog ==\n';
  assert.deepEqual(await check(theme(t, { 'readme.txt': good }), 'readme-headers'), []);

  const style = '/*\nTheme Name: Acme\nRequires PHP: 8.0\nLicense: GPLv2\n*/';
  const diff = await check(theme(t, { 'style.css': style, 'readme.txt': good }), 'readme-headers');
  assert.deepEqual(messages(diff), ['"Requires PHP" is 7.4 in readme.txt and 8.0 in style.css. Use the same value in both.']);
});

test('tested-up-to', async (t) => {
  const style = (v: string): string => `/*\nTheme Name: Acme\nTested up to: ${v}\n*/`;
  fakeNet(t, new Map([[CORE, { status: 200, body: { offers: [{ version: '6.9.1' }] } }]]));
  const old = await check(theme(t, { 'style.css': style('6.7') }), 'tested-up-to');
  assert.deepEqual(messages(old), ['Tested up to is 6.7. The latest WordPress is 6.9.']);
  assert.deepEqual([old[0]!.severity, old[0]!.category, old[0]!.location], ['warning', 'compatibility', { file: 'style.css' }]);
  assert.deepEqual(await check(theme(t, { 'style.css': style('6.9') }), 'tested-up-to'), []);
  assert.deepEqual(await check(theme(t, { 'style.css': style('soon') }), 'tested-up-to'), []);
  const fromReadme = await check(theme(t, { 'readme.txt': 'Tested up to: 6.1\n' }), 'tested-up-to');
  assert.equal(fromReadme[0]!.location.file, 'readme.txt');

  fakeNet(t, new Map());
  const notes: string[] = [];
  assert.deepEqual(await check(theme(t, { 'style.css': style('5.0') }), 'tested-up-to', notes), []);
  assert.deepEqual(notes, ['Could not ask wordpress.org for the latest version, so the Tested up to rule was left out.']);
});

test('asset-licenses', async (t) => {
  assert.deepEqual(await check(theme(t, { 'assets/images/a.png': 'x' }), 'asset-licenses'), []);
  const files = { 'readme.txt': 'Images in assets/images are CC0.\nfonts: inter', 'assets/images/a.png': 'x', 'assets/img/bird.png': 'x', 'assets/img/cow.jpg': 'x', 'logo.svg': 'x', 'screenshot.png': 'x' };
  const f = await check(theme(t, files), 'asset-licenses');
  assert.deepEqual(messages(f), [
    '2 images in assets/img are not listed in readme.txt.',
    '1 image in the theme folder is not listed in readme.txt.',
    'readme.txt does not say where the images in the screenshot come from.',
  ]);
  assert.deepEqual(f.map((x) => x.location.file), ['assets/img/bird.png', 'logo.svg', 'screenshot.png']);
  assert.deepEqual([f[0]!.severity, f[0]!.category], ['warning', 'other']);

  const fonts = { 'readme.txt': 'x', 'assets/fonts/Roboto-Bold.woff2': 'x', 'assets/fonts2/Lato-Bold.woff2': 'x', 'assets/fonts3/OFL.txt': 'x', 'assets/fonts3/Mono.ttf': 'x' };
  const g = await check(theme(t, fonts), 'asset-licenses');
  assert.deepEqual(messages(g), ['The fonts in assets/fonts have no license file, and readme.txt does not list them.', 'The fonts in assets/fonts2 have no license file, and readme.txt does not list them.']);
  assert.equal(g[0]!.location.file, 'assets/fonts/Roboto-Bold.woff2');
  const named = await check(theme(t, { 'readme.txt': 'Roboto, OFL', 'assets/fonts/Roboto-Bold.woff2': 'x' }), 'asset-licenses');
  assert.deepEqual(named, []);
});

test('skip-link', async (t) => {
  const block = theme(t, { 'templates/index.html': '<!-- wp:group {"tagName":"div"} -->' });
  const f = await check(block, 'skip-link');
  assert.deepEqual(messages(f), ['No template has a group with the tag name main, so WordPress adds no skip link.']);
  assert.deepEqual([f[0]!.severity, f[0]!.category, f[0]!.location], ['warning', 'accessibility', { file: 'templates/index.html' }]);
  assert.deepEqual(await check(theme(t, { 'templates/index.html': 'x', 'parts/a.html': '<!-- wp:group {"tagName": "main"} -->' }), 'skip-link'), []);

  const classic = await check(theme(t, { 'header.php': '<a href="/x">Home</a>' }), 'skip-link');
  assert.deepEqual(messages(classic), ['No skip link to the main content was found.']);
  assert.deepEqual(classic[0]!.location, { file: 'header.php' });
  assert.deepEqual(await check(theme(t, { 'header.php': "<a class='skip-link screen-reader-text' href='#content'>Skip</a>" }), 'skip-link'), []);
  assert.deepEqual(await check(theme(t, { 'style.css': '/*\nTheme Name: C\nTemplate: parent\n*/' }), 'skip-link'), []);
});

test('minified-without-source', async (t) => {
  const f = await check(theme(t, { 'js/a.min.js': 'x', 'js/b.min.js': 'x', 'src/b.js': 'x', 'css/c.min.css': 'x' }), 'minified-without-source');
  assert.deepEqual(messages(f), ['css/c.min.css has no readable source in the theme.', 'js/a.min.js has no readable source in the theme.']);
  assert.deepEqual([f[0]!.severity, f[0]!.category], ['warning', 'other']);
});

test('pot-missing', async (t) => {
  const style = '/*\nTheme Name: Acme\nTags: translation-ready, blog\n*/';
  const f = await check(theme(t, { 'style.css': style }), 'pot-missing');
  assert.deepEqual(messages(f), ['The theme has the tag translation-ready but no .pot file.']);
  assert.deepEqual([f[0]!.severity, f[0]!.category, f[0]!.location], ['info', 'i18n', { file: 'style.css' }]);
  assert.match(f[0]!.hint!, /^Generate one with: wp i18n make-pot \. languages\/wps-.*\.pot /);
  // Loading a text domain is not a claim. Themes on wordpress.org get their translations from there.
  assert.equal((await check(theme(t, { 'functions.php': '<?php load_theme_textdomain( "x" );' }), 'pot-missing')).length, 0);
  assert.deepEqual(await check(theme(t, { 'style.css': style, 'languages/acme.pot': '' }), 'pot-missing'), []);
  assert.deepEqual(await check(theme(t), 'pot-missing'), []);
});

test('placeholder-content', async (t) => {
  const dir = theme(t, {
    'patterns/a.php': '<?php\n/**\n * @author jane@real.com\n */\n?>\n<p>Write to jane@real.com</p>\n<p>hello@example.com</p>\n<a href="#">More</a>\n<a href="#" role="button">Open</a>\n<a href="#x" aria-controls="m">Open</a>',
  });
  const f = await check(dir, 'placeholder-content');
  assert.deepEqual(messages(f), ['The address jane@real.com looks real. Use a placeholder such as hello@example.com.', 'A link points to "#".']);
  assert.deepEqual(f.map((x) => [x.severity, x.location.line]), [['warning', 6], ['info', 8]]);
  assert.equal(f[0]!.category, 'other');
  assert.deepEqual(await check(theme(t, { 'other/a.html': 'jane@real.com <a href="#">x</a>' }), 'placeholder-content'), []);
});

test('readme-copyright', async (t) => {
  const f = await check(theme(t, { 'readme.txt': 'Copyright 2024 Other Theme' }), 'readme-copyright');
  assert.deepEqual(messages(f), ['readme.txt has no copyright notice that names the theme.']);
  assert.deepEqual([f[0]!.severity, f[0]!.category, f[0]!.location], ['warning', 'other', { file: 'readme.txt' }]);
  assert.match(f[0]!.hint!, new RegExp(`^Add a line such as "Acme Theme WordPress Theme, Copyright ${new Date().getFullYear()} Jane Doe"\\.`));
  assert.deepEqual(await check(theme(t, { 'readme.txt': 'Acme Theme WordPress Theme, Copyright 2024 Jane' }), 'readme-copyright'), []);
  assert.deepEqual(await check(theme(t), 'readme-copyright'), []);
  const lic = await check(theme(t, { 'readme.txt': '(c) 2024 acme theme', LICENSE: 'GPL' }), 'readme-copyright');
  assert.deepEqual(messages(lic), ['LICENSE does not hold the full text of the GPL.']);
  assert.equal(lic[0]!.severity, 'info');
  assert.deepEqual(await check(theme(t, { 'readme.txt': '(c) 2024 acme theme', 'license.txt': 'TERMS AND CONDITIONS FOR COPYING' }), 'readme-copyright'), []);
});

test('link-underline', async (t) => {
  const json = (own: string, inContent?: string): string =>
    JSON.stringify({ styles: { elements: { link: { typography: { textDecoration: own } } }, blocks: inContent ? { 'core/post-content': { elements: { link: { typography: { textDecoration: inContent } } } } } : {} } });
  const f = await check(theme(t, { 'theme.json': json('none') }), 'link-underline');
  assert.deepEqual(messages(f), ['Links are not underlined (styles.elements.link in theme.json).']);
  assert.deepEqual([f[0]!.severity, f[0]!.category, f[0]!.location], ['warning', 'accessibility', { file: 'theme.json' }]);
  assert.deepEqual(await check(theme(t, { 'theme.json': json('none', 'underline') }), 'link-underline'), []);
  assert.deepEqual(await check(theme(t, { 'theme.json': json('underline') }), 'link-underline'), []);
  assert.deepEqual(await check(theme(t, { 'theme.json': '{' }), 'link-underline'), []);
});

test('plugin-territory', async (t) => {
  const dir = theme(t, { 'functions.php': '<?php\n// wp_mail( $a );\n wp_mail( $a );\nadd_action( "wp_ajax_nopriv_x", "y" );\nregister_rest_route( "a", "/b" );\n?>\n<meta name="description" content="">\n<script type="application/ld+json">{}</script>' });
  const f = await check(dir, 'plugin-territory');
  assert.deepEqual(f.map((x) => x.location.line), [3, 4, 5, 7, 8]);
  assert.equal(f[0]!.message, 'The theme sends mail with wp_mail(). That belongs in a plugin.');
  assert.deepEqual([f[0]!.severity, f[0]!.category], ['warning', 'correctness']);
  assert.deepEqual(await check(theme(t, { 'functions.php': '<?php\n' }), 'plugin-territory'), []);
});

test('customizer-textareas', async (t) => {
  const four = "<?php\n$a = ['type' => 'textarea'];\n$b = [\"type\" => \"textarea\"];\n$c = ['type'=>'textarea'];\nnew WP_Customize_Code_Editor_Control();";
  const f = await check(theme(t, { 'inc/c.php': four }), 'customizer-textareas');
  assert.deepEqual(messages(f), ['The Customizer has 4 textarea controls. Reviewers ask for three at most.']);
  assert.deepEqual([f[0]!.severity, f[0]!.category, f[0]!.location], ['info', 'other', {}]);
  assert.deepEqual(await check(theme(t, { 'inc/c.php': four.split('\n').slice(0, 4).join('\n') }), 'customizer-textareas'), []);
});

test('footer-copyright', async (t) => {
  const dir = theme(t, { 'footer.php': '<p>&copy; 2024 Acme Theme</p>\n<p>Copyright <?php bloginfo( "name" ); ?></p>\n<p>(c) Jane Doe</p>\n<p>Made by Jane Doe</p>', 'parts/footer.html': '<p>© Acme Theme</p>' });
  const f = await check(dir, 'footer-copyright');
  assert.deepEqual(f.map((x) => [x.location.file, x.location.line]), [['footer.php', 1], ['parts/footer.html', 1]]);
  assert.equal(f[0]!.message, 'A copyright line names the theme or its author.');
  assert.deepEqual([f[0]!.severity, f[0]!.category], ['warning', 'other']);
});

test('remote-fonts', async (t) => {
  const dir = theme(t, { 'style.css': STYLE + '@import url("https://fonts.googleapis.com/css");', 'js/a.js': 'var u = "https://fonts.bunny.net/x";', 'theme.json': '{}' });
  const f = await check(dir, 'remote-fonts');
  assert.deepEqual(messages(f), ['Fonts are loaded from fonts.bunny.net.', 'Fonts are loaded from fonts.googleapis.com.']);
  assert.deepEqual(f.map((x) => x.location), [{ file: 'js/a.js', line: 1 }, { file: 'style.css', line: 6 }]);
  assert.deepEqual(await check(theme(t), 'remote-fonts'), []);
});

test('demo-content', async (t) => {
  const dir = theme(t, { 'inc/a.php': '<?php\n// wp_insert_user( $x );\nadd_filter( "pt-ocdi/import_files", "f" );\nwp_create_category( "x" );\n$ok = 1;' });
  const f = await check(dir, 'demo-content');
  assert.deepEqual(f.map((x) => x.location.line), [3, 4]);
  assert.equal(f[0]!.message, 'The theme imports demo content or creates content of its own.');
  assert.deepEqual([f[0]!.severity, f[0]!.category], ['warning', 'correctness']);
});

test('creates-site-data', async (t) => {
  const dir = theme(t, {
    'functions.php': `<?php
add_action( 'after_switch_theme', function () {
	wp_insert_post( array( 'post_title' => 'Home', 'post_type' => 'page' ) );
} );
add_action( 'after_switch_theme', function () {
	set_theme_mod( 'accent', '#fff' );
	add_theme_support( 'title-tag' );
	register_nav_menus( array( 'main' => 'Main' ) );
	flush_rewrite_rules();
} );
add_action( 'after_setup_theme', 'acme_setup' );
if ( ! get_option( 'acme_demo_imported' ) ) {
	update_option( 'show_on_front', 'page' );
	update_option( 'acme_imported', 1 );
}
`,
    'inc/setup.php': "<?php\nfunction acme_setup() {\n\tadd_theme_support( 'post-thumbnails' );\n\t$id = wp_create_nav_menu( 'Main' );\n\tset_theme_mod( 'nav_menu_locations', array() );\n}",
  });
  const f = await check(dir, 'creates-site-data');
  assert.deepEqual(f.map((x) => [x.location.file, x.location.line]), [['functions.php', 3], ['inc/setup.php', 4], ['inc/setup.php', 5], ['functions.php', 13]]);
  assert.equal(f[0]!.message, 'The theme creates site content or settings when it is activated.');
  assert.deepEqual([f[0]!.severity, f[0]!.category], ['warning', 'correctness']);
  assert.equal(f[0]!.hint, 'Ask first: show a notice with a button that runs the setup, and leave the site as it was until the user agrees.');
  // Own settings, supports and registrations are fine, and so is the same call outside a hook.
  const quiet = theme(t, { 'functions.php': "<?php\nadd_action( 'after_switch_theme', function () { set_theme_mod( 'accent', 1 ); flush_rewrite_rules(); } );\nfunction later() { wp_insert_post( array() ); }\nadd_action( 'init', 'later' );\nif ( ! get_option( 'acme_version' ) ) { wp_insert_post( array() ); }" });
  assert.deepEqual(await check(quiet, 'creates-site-data'), []);
  // A line that demo-content reports is left to it.
  const both = theme(t, { 'functions.php': "<?php\nadd_action( 'after_switch_theme', function () { wp_insert_post( array() ); wp_create_category( 'x' ); } );" });
  assert.equal((await check(both, 'creates-site-data')).length, 0);
  assert.equal((await check(both, 'demo-content')).length, 1);
});

test('activation-redirect', async (t) => {
  const dir = theme(t, {
    'functions.php': `<?php
add_action( 'after_switch_theme', function () {
	wp_safe_redirect( admin_url( 'themes.php?page=welcome' ) );
} );
function acme_admin_init() {
	global $pagenow;
	if ( isset( $_GET['activated'] ) && 'themes.php' === $pagenow ) {
		wp_redirect( admin_url( 'admin.php?page=acme' ) );
		exit;
	}
	if ( ! current_user_can( 'edit_posts' ) ) {
		wp_redirect( home_url() );
	}
}
`,
  });
  const f = await check(dir, 'activation-redirect');
  assert.deepEqual(f.map((x) => x.location.line), [3, 8]);
  assert.equal(f[0]!.message, 'The theme redirects the user after activation.');
  assert.deepEqual([f[0]!.severity, f[0]!.category], ['warning', 'correctness']);
  assert.deepEqual(await check(theme(t, { 'functions.php': "<?php\nfunction a() { if ( ! is_user_logged_in() ) { wp_redirect( wp_login_url() ); } }" }), 'activation-redirect'), []);
});

test('notice-not-dismissible', async (t) => {
  const dir = theme(t, {
    'functions.php': `<?php
add_action( 'admin_notices', function () {
	echo '<div class="notice notice-info"><p>Welcome</p></div>';
} );
add_action( 'admin_notices', 'acme_ok' );
function acme_ok() {
	echo '<div class="notice notice-info is-dismissible"><p>Hi</p></div>';
}
add_action( 'all_admin_notices', 'acme_script' );
function acme_script() {
	echo '<div class="updated"><p>Hi</p></div><script>jQuery(".x").on("click", dismissNotice);</script>';
}
add_action( 'network_admin_notices', 'acme_html' );
function acme_html() { ?>
	<div class="error"><p>Broken</p></div>
<?php }
`,
  });
  const f = await check(dir, 'notice-not-dismissible');
  assert.deepEqual(f.map((x) => x.location.line), [3, 15]);
  assert.equal(f[0]!.message, 'An admin notice cannot be dismissed.');
  assert.deepEqual([f[0]!.severity, f[0]!.category], ['warning', 'other']);
});

test('readme-not-english', async (t) => {
  const english = '=== Acme ===\nA clean theme for blogs. You can use it with the block editor and change the colors of the theme in the Site Editor. This is a simple theme that works for most sites and is easy to set up. See https://example.com/docs for the setup guide. The theme has no options that you need to learn before you start to write.\n';
  assert.deepEqual(await check(theme(t, { 'readme.txt': english.repeat(2) }), 'readme-not-english'), []);
  const german = 'Ein schlichtes Theme für Blogs und Magazine. Mit dem Theme lassen sich die Farben im Editor ändern, und die Schriften sind bereits eingebunden. Die Installation dauert nur wenige Minuten, danach kann man sofort mit dem Schreiben beginnen. Alle Einstellungen findet man unter Design im Menü des Dashboards.\n';
  const spanish = 'Un tema sencillo para blogs y revistas. Con este tema se pueden cambiar los colores desde el editor, y las fuentes ya están incluidas. La instalación tarda unos minutos, después se puede empezar a escribir de inmediato. Todos los ajustes están en el menú Apariencia del escritorio.\n';
  for (const text of [german, spanish]) {
    const f = await check(theme(t, { 'readme.txt': text.repeat(2) }), 'readme-not-english');
    assert.deepEqual(messages(f), ['readme.txt is not in English.']);
    assert.deepEqual([f[0]!.severity, f[0]!.category, f[0]!.location], ['info', 'other', { file: 'readme.txt' }]);
  }
  const greek = '=== Acme ===\nΈνα απλό θέμα για ιστολόγια και περιοδικά. Τα χρώματα αλλάζουν στον επεξεργαστή.';
  assert.equal((await check(theme(t, { 'readme.txt': greek }), 'readme-not-english')).length, 1);
  assert.deepEqual(await check(theme(t), 'readme-not-english'), []);
});

test('the engine runs every rule, with no errors, a docs link and the share sentence', async (t) => {
  fakeNet(t, new Map([[CORE, { status: 200, body: { offers: [{ version: '6.9' }] } }]]));
  const dir = theme(t, {
    'style.css': '/*\nTheme Name: Acme Theme\nAuthor: Jane Doe\nTested up to: 6.1\nTags: translation-ready\n*/',
    'readme.txt': 'Acme\n',
    'index.php': '<h1>Hello world</h1>',
    'js/a.min.js': 'x',
    'footer.php': '<p>Copyright Acme Theme</p>',
  });
  const notes: string[] = [];
  const r = await run(detectTarget(dir), { engines: [review], level: 7, directory: 'wporg', onEvent: (e) => e.type === 'engine:note' && notes.push(e.message) });
  assert.equal(r.engines[0]!.status, 'ok');
  const found = new Set(r.findings.map((f) => f.rule));
  for (const id of ['untranslated-text', 'readme-headers', 'tested-up-to', 'skip-link', 'minified-without-source', 'pot-missing', 'readme-copyright', 'footer-copyright']) assert.ok(found.has(id), id);
  assert.ok(r.findings.every((f) => f.severity !== 'error'));
  assert.ok(r.findings.every((f) => f.docs?.endsWith('/theme-review-feedback.md') && / Reviewers raised this in about \d+% of recent theme reviews\.$/.test(f.hint ?? '')));
  assert.deepEqual(notes, []);
});

test('a rule that throws does not stop the others', async (t) => {
  const dir = theme(t, { 'index.php': '<h1>Hello world</h1>' });
  const original = rules['remote-fonts']!;
  rules['remote-fonts'] = {
    ...original,
    run: () => {
      throw new Error('boom');
    },
  };
  t.after(() => {
    rules['remote-fonts'] = original;
  });
  const notes: string[] = [];
  const f = await review.run({ target: detectTarget(dir), level: 7, directory: 'wporg', note: (m) => notes.push(m) });
  assert.ok(f.some((x) => x.rule === 'untranslated-text'));
  assert.deepEqual(notes, ['The rule remote-fonts could not run: boom']);
});

test('the engine is registered for themes and plugins at level 3', () => {
  assert.equal(engines.filter((e) => e.id === 'review').length, 1);
  assert.deepEqual([review.level, review.kinds], [3, ['theme', 'plugin']]);
  for (const id of ['theme-review', 'theme-fonts', 'activation-lock']) assert.ok(!engines.some((e) => e.id === id), id);
});

test('every rule has a level between 0 and 10 and at least one kind', () => {
  for (const [id, r] of Object.entries(rules)) {
    assert.equal(r.id, id);
    assert.ok(Number.isInteger(r.level) && r.level >= 0 && r.level <= 10, id);
    assert.ok(r.kinds.length > 0, id);
  }
});

// Each of these was a false finding on a default theme of WordPress.
test('rules tuned on real themes', async (t) => {
  const style = '/*\nTheme Name: Acme\nLicense: GNU General Public License v2 or later\n*/';
  const readme = '=== Acme ===\nLicense: GPLv2 or later\nFira Sans Font, SIL OFL 1.1, https://example.com';
  const dir = theme(t, { 'style.css': style, 'readme.txt': readme, 'assets/fonts/fira/FiraSans-Bold.woff2': '', 'patterns/a.php': '<a href="#">a</a>\n<a href="#">b</a>' });
  assert.ok(!(await check(dir, 'readme-headers')).some((f) => f.message.startsWith('"License"')));
  assert.deepEqual(await check(dir, 'asset-licenses'), []);
  assert.deepEqual(messages(await check(dir, 'placeholder-content')), ['2 links point to "#".']);
});

const FONT_RULES = ['font-file-missing', 'font-family-unloaded', 'font-source-missing'];
const face = (src: string | string[]) => ({ fontFamily: 'Inter', fontWeight: '400', src });
const themeJson = (fontFamilies: unknown[], styles: unknown = {}) => JSON.stringify({ version: 3, settings: { typography: { fontFamilies } }, styles }, null, 2);

/** The findings of the three font rules that apply at this level and directory. */
async function fonts(dir: string, level = 6, directory?: 'wporg' | 'envato'): Promise<RawFinding[]> {
  const ctx = { target: detectTarget(dir), level, ...(directory ? { directory } : {}), note() {} };
  const subject = loadSubject(ctx);
  const chosen = FONT_RULES.filter((id) => ruleApplies(rules[id]!, ctx));
  return (await Promise.all(chosen.map((id) => rules[id]!.run(subject)))).flat();
}

function fontTheme(t: TestContext, json: string): string {
  const dir = makeTheme(tmp(t));
  write(path.join(dir, 'theme.json'), json);
  return dir;
}

test('a valid local font has no findings', async (t) => {
  const dir = fontTheme(t, themeJson([{ name: 'Inter', slug: 'inter', fontFamily: 'Inter, sans-serif', fontFace: [face('file:./assets/fonts/inter.woff2')] }]));
  write(path.join(dir, 'assets', 'fonts', 'inter.woff2'));
  assert.deepEqual(await fonts(dir), []);
});

test('font-file-missing reports a missing file with its line', async (t) => {
  const dir = fontTheme(t, themeJson([{ name: 'Inter', slug: 'inter', fontFamily: 'Inter', fontFace: [face('file:./assets/fonts/inter.woff2')] }]));
  const [f, ...rest] = await fonts(dir);
  assert.equal(rest.length, 0);
  assert.equal(f!.rule, 'font-file-missing');
  assert.equal(f!.severity, 'warning');
  assert.equal(f!.message, 'theme.json loads file:./assets/fonts/inter.woff2, and the theme has no such file.');
  assert.equal(f!.location.file, 'theme.json');
  assert.equal(f!.location.line, 14);
});

test('font-file-missing reports only the missing entry of an array src', async (t) => {
  const dir = fontTheme(t, themeJson([{ name: 'Inter', slug: 'inter', fontFamily: 'Inter', fontFace: [face(['file:./a.woff2', 'file:./b.woff'])] }]));
  write(path.join(dir, 'a.woff2'));
  const found = await fonts(dir);
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /file:\.\/b\.woff,/);
});

test('font-family-unloaded reports a selected family with no fontFace and no fallback', async (t) => {
  const fams = [
    { name: 'Bare', slug: 'bare', fontFamily: 'Bare' },
    { name: 'Safe', slug: 'safe', fontFamily: 'Safe, sans-serif' },
    { name: 'System', slug: 'system', fontFamily: '-apple-system, "Segoe UI", sans-serif, "Apple Color Emoji"' },
    { name: 'Idle', slug: 'idle', fontFamily: 'Idle' },
  ];
  const styles = { typography: { fontFamily: 'var(--wp--preset--font-family--bare)' }, elements: { h1: { typography: { fontFamily: 'var:preset|font-family|safe' } }, h2: { typography: { fontFamily: 'var:preset|font-family|system' } } } };
  const found = await fonts(fontTheme(t, themeJson(fams, styles)));
  assert.equal(found.length, 1);
  assert.equal(found[0]!.rule, 'font-family-unloaded');
  assert.equal(found[0]!.message, 'The font "Bare" is selected but never loaded, and its stack has no fallback.');
});

test('font-family-unloaded sees a family selected in a template part', async (t) => {
  const dir = fontTheme(t, themeJson([{ name: 'Bare', slug: 'bare', fontFamily: 'Bare' }]));
  assert.deepEqual(await fonts(dir), []);
  write(path.join(dir, 'parts', 'header.html'), '<!-- wp:site-title {"style":{"typography":{"fontFamily":"var:preset|font-family|bare"}}} /-->');
  assert.equal((await fonts(dir)).length, 1);
});

test('a style variation adds a family with a missing file', async (t) => {
  const dir = fontTheme(t, themeJson([]));
  write(path.join(dir, 'styles', 'dark.json'), themeJson([{ name: 'Mono', slug: 'mono', fontFamily: 'Mono', fontFace: [face('file:./fonts/mono.woff2')] }]));
  const [f, ...rest] = await fonts(dir);
  assert.equal(rest.length, 0);
  assert.equal(f!.rule, 'font-file-missing');
  assert.equal(f!.location.file, 'styles/dark.json');
});

test('font-source-missing runs at level 7 for the wordpress.org directory', async (t) => {
  const dir = fontTheme(t, themeJson([{ name: 'Inter', slug: 'inter', fontFamily: 'Inter, sans-serif', fontFace: [face('file:./inter.woff2')] }]));
  write(path.join(dir, 'inter.woff2'));
  write(path.join(dir, 'readme.txt'), '== Credits ==\nInter, SIL Open Font License\nUnrelated line\n');
  assert.deepEqual(await fonts(dir, 6, 'wporg'), []);
  assert.deepEqual(await fonts(dir, 7), []);
  assert.deepEqual(await fonts(dir, 7, 'envato'), []);
  const [f, ...rest] = await fonts(dir, 7, 'wporg');
  assert.equal(rest.length, 0);
  assert.equal(f!.rule, 'font-source-missing');
  assert.equal(f!.severity, 'info');
  assert.equal(f!.category, 'other');
  assert.equal(f!.message, 'readme.txt names the font "Inter" without the URL of its source.');
  write(path.join(dir, 'readme.txt'), 'Inter, SIL Open Font License\nhttps://fonts.google.com/specimen/Inter\n');
  assert.deepEqual(await fonts(dir, 7, 'wporg'), []);
  write(path.join(dir, 'readme.txt'), 'Nothing about fonts here\n');
  assert.deepEqual(await fonts(dir, 7, 'wporg'), []);
});

test('a classic theme without theme.json has no font findings', async (t) => {
  assert.deepEqual(await fonts(makeTheme(tmp(t))), []);
});

async function locked(t: TestContext, php: string, name = 'inc.php'): Promise<number[]> {
  const dir = makePlugin(tmp(t));
  write(path.join(dir, name), php);
  const found = await rules['features-locked']!.run(loadSubject({ target: detectTarget(dir), level: 7, note() {} }));
  return found.map((f) => f.location.line!);
}

test('features-locked reports an early return when the product is not activated', async (t) => {
  assert.deepEqual(await locked(t, "<?php\n\nif ( ! get_option( 'mytheme_license_key' ) ) {\n\treturn;\n}\n"), [3]);
});

test('features-locked reports feature files required inside an activation check', async (t) => {
  assert.deepEqual(await locked(t, "<?php\nif ( $theme->is_activated() ) {\n\trequire_once 'features.php';\n}\n"), [2]);
});

test('features-locked reports wp_die when the license is missing', async (t) => {
  assert.deepEqual(await locked(t, "<?php\nif ( empty( $purchase_code ) )\n\twp_die( 'No license' );\n"), [2]);
});

test('features-locked reports a feature hook added inside the license check', async (t) => {
  assert.deepEqual(await locked(t, "<?php\nif ( license_is_valid() ) {\n\tadd_action( 'init', 'mytheme_register_types' );\n}\n"), [2]);
});

test('features-locked reports elseif and an envato item id check', async (t) => {
  const php = "<?php\nif ( $a ) {\n} elseif ( envato_item_id() === 5 ) {\n\tadd_shortcode( 'x', 'y' );\n}\n";
  assert.deepEqual(await locked(t, php), [3]);
});

test('features-locked ignores a body that only shows a notice', async (t) => {
  const php = "<?php\nif ( ! $is_activated ) {\n\tadd_action( 'admin_notices', function () {\n\t\tif ( ! x() ) { return; }\n\t\techo 'Activate';\n\t} );\n\t$msg = 'Enter your license';\n}\n";
  assert.deepEqual(await locked(t, php), []);
});

test('features-locked ignores echo of license text, unrelated checks and comments', async (t) => {
  assert.deepEqual(await locked(t, "<?php\nif ( ! $license ) { echo 'Enter a license key'; }\n"), []);
  assert.deepEqual(await locked(t, "<?php\nif ( ! defined( 'ABSPATH' ) ) {\n\texit;\n}\n"), []);
  assert.deepEqual(await locked(t, "<?php\n// if ( $license ) { return; }\n/* if ( is_activated() ) { exit; } */\nif ( $a ) { return; }\n"), []);
});

test('features-locked ignores the activation redirect and a license file include', async (t) => {
  assert.deepEqual(await locked(t, "<?php\nif ( isset( $_GET['activated'] ) && is_admin() ) {\n\twp_safe_redirect( admin_url( 'themes.php?page=welcome' ) );\n\texit;\n}\n"), []);
  assert.deepEqual(await locked(t, "<?php\nif ( file_exists( __DIR__ . '/license.txt' ) ) {\n\tinclude __DIR__ . '/license.txt';\n}\n"), []);
});

test('features-locked reports a license status check that returns early', async (t) => {
  assert.deepEqual(await locked(t, "<?php\nif ( 'valid' !== get_option( 'acme_license_status' ) ) {\n\treturn;\n}\n"), [2]);
});

test('features-locked skips vendor and minified files', async (t) => {
  const php = "<?php\nif ( $license ) { return; }\n";
  assert.deepEqual(await locked(t, php, 'vendor/x.php'), []);
  assert.deepEqual(await locked(t, php, 'a.min.php'), []);
});

test('stripComments keeps line numbers and strings', () => {
  const out = stripComments("<?php\n/* a\nb */\n$u = 'http://x'; // c\n");
  assert.equal(out.split('\n').length, 5);
  assert.ok(out.includes("'http://x'"));
  assert.ok(!out.includes('// c'));
});

// The gates: kind, level and directory.
const LOCK = "<?php\nif ( ! get_option( 'acme_license_key' ) ) {\n\treturn;\n}\n";
const ids = async (dir: string, level: number, directory?: 'wporg' | 'envato'): Promise<string[]> => {
  const found = await review.run({ target: detectTarget(dir), level, ...(directory ? { directory } : {}), note() {} });
  return [...new Set(found.map((f) => f.rule))].sort();
};

test('a directory rule does not run without the directory and runs with it', async (t) => {
  const dir = theme(t, { 'index.php': "<link href=\"https://fonts.googleapis.com/css\">\n" });
  assert.ok(!(await ids(dir, 7)).includes('remote-fonts'));
  assert.ok(!(await ids(dir, 7, 'envato')).includes('remote-fonts'));
  assert.ok((await ids(dir, 7, 'wporg')).includes('remote-fonts'));
});

test('a directory rule runs at level 10 without a directory', async (t) => {
  const dir = theme(t, { 'index.php': "<link href=\"https://fonts.googleapis.com/css\">\n" });
  assert.ok((await ids(dir, 10)).includes('remote-fonts'));
});

test('a rule above the level of the run does not run', async (t) => {
  const dir = theme(t, { 'functions.php': "<?php\nadd_action( 'after_switch_theme', function () { wp_insert_post( array() ); } );" });
  assert.ok(!(await ids(dir, 4)).includes('creates-site-data'));
  assert.ok((await ids(dir, 5)).includes('creates-site-data'));
  const fontless = fontTheme(t, themeJson([{ name: 'Inter', slug: 'inter', fontFamily: 'Inter', fontFace: [face('file:./a.woff2')] }]));
  assert.ok(!(await ids(fontless, 2)).includes('font-file-missing'));
  assert.ok((await ids(fontless, 3)).includes('font-file-missing'));
});

test('features-locked runs on a plugin under the wordpress.org directory', async (t) => {
  const dir = makePlugin(tmp(t));
  write(path.join(dir, 'inc.php'), LOCK);
  assert.deepEqual(await ids(dir, 7, 'wporg'), ['features-locked']);
  assert.deepEqual(await ids(dir, 7, 'envato'), ['features-locked']);
  assert.deepEqual(await ids(dir, 7), []);
  assert.deepEqual(await ids(dir, 6, 'wporg'), []);
});

test('notice-not-dismissible runs on a plugin', async (t) => {
  const dir = makePlugin(tmp(t));
  write(path.join(dir, 'inc.php'), "<?php\nadd_action( 'admin_notices', function () {\n\techo '<div class=\"notice notice-info\"><p>Hi</p></div>';\n} );\n");
  assert.deepEqual(await ids(dir, 5), ['notice-not-dismissible']);
});

test('rules for themes do not run on a plugin', async (t) => {
  const dir = makePlugin(tmp(t));
  write(path.join(dir, 'inc.php'), "<?php\nadd_action( 'after_switch_theme', function () { wp_insert_post( array() ); } );\n");
  assert.deepEqual(await ids(dir, 10), []);
});

test('minified-without-source runs on a plugin at level 5 with no directory', async (t) => {
  const dir = makePlugin(tmp(t));
  write(path.join(dir, 'js', 'a.min.js'), 'x');
  write(path.join(dir, 'js', 'b.min.js'), 'x');
  write(path.join(dir, 'src', 'b.js'), 'x');
  const found = await review.run({ target: detectTarget(dir), level: 5, note() {} });
  assert.deepEqual(found.map((f) => f.rule), ['minified-without-source']);
  assert.equal(found[0]!.message, 'js/a.min.js has no readable source in the plugin.');
  assert.deepEqual(await ids(dir, 4), []);
});

test('every rule has both a check and its kinds, level and directories', async () => {
  const { rules } = await import('../src/engines/review.ts');
  for (const [id, r] of Object.entries(rules)) {
    assert.ok(Array.isArray(r.kinds) && r.kinds.length > 0, `${id} has no kinds`);
    assert.equal(typeof r.run, 'function', `${id} has no check`);
  }
});

test('review names its level and directory as its variant, so a run with other rules does not count them fixed', async () => {
  const { review } = await import('../src/engines/review.ts');
  assert.equal(review.variant!({ level: 6 }), '@6');
  assert.equal(review.variant!({ level: 7, directory: 'wporg' }), 'wporg@7');
});
