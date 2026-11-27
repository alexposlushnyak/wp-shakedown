import type { Directory, TargetKind } from '../types.ts';

/**
 * A check that needs someone to read the code and judge it. No tool answers it from the files alone, so the report
 * hands it to an AI assistant with a prompt and the files to start from. The list comes from the review comments in
 * themes.trac and from what WPCS, PHPStan and Theme Check leave open.
 */
export interface AssistantCheck {
  id: string;
  title: string;
  kinds: readonly TargetKind[];
  /** The lowest level that lists the check. */
  level: number;
  /** The directories that require it. Listed for one of them, or at level 10. */
  directories?: readonly Directory[];
  /**
   * The files that make the check worth asking: their extensions, and a pattern their text must match.
   * Without it the check is listed for every target of its kinds.
   */
  look?: { ext: readonly string[]; match: RegExp };
  /** What the assistant verifies. The tool adds the shared opening and the answer format. */
  prompt: string;
  docs?: string;
}

const THEME: TargetKind[] = ['theme'];
const PLUGIN: TargetKind[] = ['plugin'];
const CODE: TargetKind[] = ['theme', 'plugin'];
const WPORG: Directory[] = ['wporg'];
const BOTH: Directory[] = ['wporg', 'envato'];
const PHP = ['php'];
const STYLES = ['css', 'scss', 'json'];
const SCRIPTS = ['js', 'jsx', 'ts', 'tsx'];

export const assistantChecks: AssistantCheck[] = [
  {
    id: 'escaping-context',
    title: 'Output is escaped late, with the function that fits its place',
    kinds: CODE,
    level: 7,
    look: { ext: PHP, match: /\b(?:echo|print|printf)\b|<\?=/ },
    prompt:
      'WPCS reports output that has no escaping function. Check what it cannot see: that each escaping function fits where the value lands. esc_attr() for an attribute, esc_url() for a URL in href or src, esc_html() for text, wp_kses_post() or wp_kses() for HTML the user may format, esc_js() only inside an inline handler, and wp_json_encode() for data passed to a script. Report output escaped with the wrong function, output escaped early and changed after that, and translated strings printed without escaping (__() where esc_html__() or esc_attr__() is needed).',
    docs: 'https://developer.wordpress.org/apis/security/escaping/',
  },
  {
    id: 'sanitize-callbacks',
    title: 'Each setting is sanitized for its type',
    kinds: CODE,
    level: 7,
    look: { ext: PHP, match: /\b(?:add_setting|register_setting|update_option|set_theme_mod)\b/ },
    prompt:
      'Check every Customizer setting, registered setting and option the code saves. Each needs a sanitize callback that fits what the control holds: a checkbox becomes a boolean, a select or radio keeps only one of its choices, a number goes through absint() or a range check, a color through sanitize_hex_color(), a URL through esc_url_raw(), HTML through wp_kses_post(). Report settings without a callback, callbacks that accept more than the control can send, and sanitize_text_field() used for HTML or URLs.',
    docs: 'https://developer.wordpress.org/apis/security/sanitizing/',
  },
  {
    id: 'request-handlers',
    title: 'Every request handler checks the nonce and the capability',
    kinds: CODE,
    level: 7,
    look: { ext: PHP, match: /\bwp_ajax_|\badmin_post_|\bregister_rest_route\b|\$_(?:POST|GET|REQUEST)\b/ },
    prompt:
      'Find every place that acts on a request: wp_ajax_ and wp_ajax_nopriv_ handlers, admin_post_ handlers, REST routes and code that reads $_POST, $_GET or $_REQUEST to change data. Each must verify a nonce (check_ajax_referer(), check_admin_referer(), wp_verify_nonce()) and check that the user may do this (current_user_can() with a fitting capability). A REST route needs a permission_callback that checks a capability; __return_true is only for data that is public anyway. Report each handler that skips one of these, and nopriv handlers that change data.',
    docs: 'https://developer.wordpress.org/apis/security/nonces/',
  },
  {
    id: 'database-queries',
    title: 'Database queries are prepared and needed',
    kinds: CODE,
    level: 7,
    look: { ext: PHP, match: /\$wpdb->/ },
    prompt:
      'Check every $wpdb query. A value that is not a constant goes in through $wpdb->prepare() with placeholders, never by string joining, and LIKE patterns go through $wpdb->esc_like(). Report queries built from request data or options without prepare(), table names taken from input, and direct queries where WP_Query, get_posts(), get_option() or the metadata API do the same job. For a theme, any direct query is a finding.',
    docs: 'https://developer.wordpress.org/reference/classes/wpdb/prepare/',
  },
  {
    id: 'outgoing-data',
    title: 'Nothing is sent or tracked without the user knowing',
    kinds: CODE,
    level: 7,
    directories: BOTH,
    look: { ext: [...PHP, ...SCRIPTS], match: /\bwp_remote_(?:get|post|request)\b|\bfetch\(|XMLHttpRequest|\blocalStorage\b|document\.cookie|https?:\/\/(?!(?:[\w-]+\.)*(?:w3\.org|gnu\.org|wordpress\.org|wordpress\.com|example\.(?:com|org|net))\b)/ },
    prompt:
      'Find every request the code sends to another server, every script, font or iframe it loads from one, and every cookie or localStorage entry it writes. For each, say what leaves the site and when. Report calls that send site or user data without the user turning it on first (usage tracking, license checks that send the site URL, error reporting), remote assets that could be bundled, and remote services the readme does not name in a privacy or third-party section.',
    docs: 'https://developer.wordpress.org/plugins/wordpress-org/detailed-plugin-guidelines/',
  },
  {
    id: 'keyboard-and-focus',
    title: 'Menus and dialogs work with the keyboard and show focus',
    kinds: THEME,
    level: 7,
    look: { ext: [...STYLES, ...SCRIPTS, ...PHP, 'html'], match: /:focus|outline\s*:\s*(?:none|0)|aria-expanded|menu-toggle|modal|navigation/i },
    prompt:
      'Read the CSS and the scripts of the menus, the mobile menu, the search toggle and any modal. Check that every link and button shows a visible focus style (an outline removed without a replacement is a finding), that the mobile menu and modals keep focus inside while open and close with Escape, that submenus open from the keyboard, and that toggles update aria-expanded. Report what fails with the file and line, and say what to add.',
    docs: 'https://make.wordpress.org/themes/handbook/review/accessibility/required/',
  },
  {
    id: 'content-links',
    title: 'Links inside content are underlined',
    kinds: THEME,
    level: 7,
    directories: WPORG,
    look: { ext: [...STYLES, 'php', 'html'], match: /text-decoration/ },
    prompt:
      'Links inside post and page content must be told apart from text without relying on color, which in practice means underlined. Read theme.json (styles.elements.link and block styles) and the CSS. Report rules that remove the underline from links in content (.entry-content a, .wp-block-post-content a, or a global a rule that content links inherit) without bringing it back. Links in navigation, buttons and titles may stay without one.',
    docs: 'https://make.wordpress.org/themes/handbook/review/accessibility/required/',
  },
  {
    id: 'reading-settings',
    title: 'The front page follows the Reading settings',
    kinds: THEME,
    level: 7,
    look: { ext: ['php', 'html'], match: /front-page|is_front_page|show_on_front|page_on_front/ },
    prompt:
      'Check front-page.php, templates/front-page.html, home.php and templates/home.html. When the site shows the latest posts on the front page, the posts must appear. When it shows a static page, that page title and content must appear, through the_content() or a core/post-content block. Report a front page that ignores either setting, for example a fixed layout of sections that shows neither the posts nor the chosen page.',
    docs: 'https://make.wordpress.org/themes/handbook/review/required/',
  },
  {
    id: 'plugin-territory',
    title: 'The theme leaves plugin features to plugins',
    kinds: THEME,
    level: 7,
    directories: BOTH,
    prompt:
      'A theme controls how the site looks. Report features a user would lose on switching themes: custom post types and taxonomies, shortcodes, SEO meta tags, schema or Open Graph output, contact or booking forms that send or store data, analytics, custom user roles, demo importers, and widgets or blocks that hold content rather than layout. A filter that only changes how core output looks is fine. For each, say which plugin kind should hold it.',
    docs: 'https://make.wordpress.org/themes/handbook/review/required/',
  },
  {
    id: 'upsell-and-notices',
    title: 'Promotion and admin notices stay within the rules',
    kinds: CODE,
    level: 7,
    directories: WPORG,
    look: { ext: [...PHP, ...SCRIPTS], match: /admin_notices|is-dismissible|\bupgrade\b|\bpremium\b|\bpro version\b|\bgo pro\b/i },
    prompt:
      'Read the admin pages, notices and Customizer sections. Admin notices must be dismissible, the dismissal must be saved so the notice does not come back, and they may not take over the dashboard. Promotion of a paid version is allowed in one place, such as a theme info page or a Customizer section, but not in notices on every screen, not as disabled controls that tease a paid feature, and not on the front end. Report each notice or upsell that breaks this, with the file and line.',
    docs: 'https://make.wordpress.org/themes/handbook/review/required/',
  },
  {
    id: 'readme-resources',
    title: 'The readme names every bundled resource with its license and source',
    kinds: CODE,
    level: 7,
    directories: BOTH,
    prompt:
      'List the images, fonts, icon sets and third party JavaScript and CSS files in the package, including the images in the screenshot. Compare the list with the Resources, Credits or Copyright section of readme.txt. Each resource needs its name, its license (compatible with GPL), its copyright holder and a source URL. Report resources the readme leaves out, entries without a license or source, and licenses that are not compatible with GPL, such as CC BY-NC or the Hippocratic License.',
    docs: 'https://make.wordpress.org/themes/handbook/review/required/',
  },
  {
    id: 'uninstall',
    title: 'Uninstalling the plugin removes what it stored',
    kinds: PLUGIN,
    level: 8,
    look: { ext: PHP, match: /\b(?:add_option|update_option|dbDelta|CREATE TABLE|wp_schedule_event|add_role)\b/ },
    prompt:
      'Find what the plugin stores: options, custom tables, scheduled events, roles and capabilities, transients and uploaded files. Check that uninstall.php or a register_uninstall_hook() callback removes them, and that deactivation clears scheduled events. On multisite the cleanup must run for every site. Report data that stays behind, and cleanup code that runs on deactivation and deletes data the user may want back.',
    docs: 'https://developer.wordpress.org/plugins/plugin-basics/uninstall-methods/',
  },
  {
    id: 'working-features',
    title: 'Every form, search and button does something',
    kinds: THEME,
    level: 8,
    look: { ext: ['php', 'html', ...SCRIPTS], match: /<form|<button|href="#"/ },
    prompt:
      'Check that each form in the templates and patterns has a working target: the search form submits to the site search, a newsletter or contact form is sent somewhere or comes from a plugin block. Check that buttons and links in patterns lead somewhere or are clearly placeholders the user edits. Report forms that go nowhere, buttons that do nothing, and placeholder text or links a user would publish without noticing.',
  },
  {
    id: 'envato-documentation',
    title: 'The documentation covers installing and setting up the theme',
    kinds: THEME,
    level: 7,
    directories: ['envato'],
    prompt:
      'Find the documentation that ships with the theme (a documentation folder, an HTML or PDF file, or a link in the readme). Check that it explains installing the theme and its plugins, importing the demo content if there is any, setting up the menus, the front page and the theme options, and where to get support. Report each part that is missing or that describes a feature the theme does not have.',
  },
];
