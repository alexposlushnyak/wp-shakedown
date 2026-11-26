import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import './env.ts';
import { engines } from '../src/engines/index.ts';
import { loadTheme, rules, themeReview, visibleTexts } from '../src/engines/theme-review.ts';
import { run } from '../src/runner.ts';
import { detectTarget } from '../src/target.ts';
import type { RawFinding } from '../src/types.ts';
import { fakeNet, tmp, write } from './helpers.ts';

const STYLE = '/*\nTheme Name: Acme Theme\nAuthor: Jane Doe\nVersion: 1.0\n*/\n';

/** Writes a theme. `style.css` gets a default header unless the files give one. */
function theme(t: TestContext, files: Record<string, string> = {}): string {
  const dir = tmp(t);
  for (const [f, text] of Object.entries({ 'style.css': STYLE, ...files })) write(path.join(dir, f), text);
  return dir;
}

async function check(dir: string, id: string, notes: string[] = []): Promise<RawFinding[]> {
  const target = detectTarget(dir);
  return rules[id]!(loadTheme({ target, level: 6, note: (m) => notes.push(m) }));
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
  const r = await run(detectTarget(dir), { engines: [themeReview], experimental: true, onEvent: (e) => e.type === 'engine:note' && notes.push(e.message) });
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
  rules['remote-fonts'] = () => {
    throw new Error('boom');
  };
  t.after(() => {
    rules['remote-fonts'] = original;
  });
  const notes: string[] = [];
  const f = await themeReview.run({ target: detectTarget(dir), level: 6, note: (m) => notes.push(m) });
  assert.ok(f.some((x) => x.rule === 'untranslated-text'));
  assert.deepEqual(notes, ['The rule remote-fonts could not run: boom']);
});

test('a default run does not use theme-review', async (t) => {
  const dir = theme(t, { 'index.php': '<h1>Hello world</h1>' });
  const only = engines.filter((e) => e.id === 'theme-review');
  assert.equal(only.length, 1);
  const r = await run(detectTarget(dir), { engines: only });
  assert.deepEqual(r.engines, []);
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
