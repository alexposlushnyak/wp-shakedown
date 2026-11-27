# Engines

An engine runs one check and turns the result into findings. Each engine has a level, the lowest [level](cli.md#levels) of a run that runs it. Fifteen engines exist, in two groups. You can add [checks of your own](checks.md).

Nine check code. They run on a theme or a plugin. A WordPress folder does not run them: it is tested as an install, and you test a theme or plugin inside it by giving the folder of that theme or plugin. `theme-check` runs on themes only.

| ID | Level | Tool | Finds |
|---|---|---|---|
| `php-lint` | 0 | `php -l` | PHP syntax errors |
| `theme-check` | 3 | Theme Check, the checks of the wordpress.org theme directory | Missing files and headers, functions a theme must not call, plugin features inside a theme, missing template tags |
| `review` | 3 | Rules of our own | What no maintained tool checks: fonts that are not loaded, content a theme creates on activation, features locked behind a license key, and what reviewers of the directories ask for. See [review](#review) |
| `wpcs` | 5 | PHP_CodeSniffer with the WordPress Coding Standards, plus the Plugin Check review rules for plugins | Unescaped output, missing nonces, unprepared SQL, translation mistakes, discouraged functions, code style |
| `php-compat` | 5 | PHP_CodeSniffer with PHPCompatibilityWP | Code that the declared PHP version cannot run |
| `phpstan` | 8 | PHPStan with the WordPress extension | Calls to functions that do not exist, wrong argument counts and types |
| `wp-json` | 1 | JSON Schema validation | Mistakes in `theme.json`, style variations and `block.json` |
| `eslint` | 6 | ESLint with the WordPress config | Undefined variables, React hook mistakes, accessibility and translation problems in JavaScript |
| `stylelint` | 6 | Stylelint with the WordPress config | Unknown properties, invalid values and duplicate selectors in CSS and SCSS |

Six check a WordPress folder as a whole. Five work from the files, and WordPress does not have to run. Three of those also ask public services. `site-health` starts WordPress through WP-CLI and needs the database of the site. See [Install health](#install-health).

| ID | Level | Finds |
|---|---|---|
| `integrity` | 4 | Core and plugin files that differ from the official release |
| `updates` | 4 | WordPress, plugins and themes that are behind, abandoned or closed |
| `vulnerabilities` | 4 | Known vulnerabilities in the installed versions |
| `config` | 2 | Risky settings in `wp-config.php` and files that should not be in a web folder |
| `suspicious-files` | 4 | Files with the marks of malware: obfuscated code, request input that reaches `eval`, web shell names |
| `site-health` | 4 | What the Site Health screen of WordPress reports: autoloaded options, missed cron events, inactive plugins and themes, PHP extensions, the database server |

A run at the default level 6 leaves out `phpstan`, and `--level 8` adds it. `review` is an exception: it runs at level 3, and each of its rules has a level of its own. Run one engine with `--engine <id>`, and it runs at any level, but a rule of `review` still waits for its own level. Run the engines for one purpose with a [preset](presets.md).

The engine receives the level of the run in its context as `level`, and the directory of the preset, if it names one, as `directory`. `review` uses both to choose its rules.

## What they need

The five PHP engines need PHP on your `PATH`. `theme-check`, `wpcs`, `php-compat` and `phpstan` also need Composer the first time they run. Without PHP and Composer, set `WP_SHAKEDOWN_PHP=bundled` and the tool runs them on a PHP it downloads. See [Without PHP](#without-php). `wp-json` needs neither. It downloads a schema from schemas.wp.org and keeps it for a week. `eslint` and `stylelint` need npm, which comes with Node.js.

On the first run the tool installs what the engines need into `~/.wp-shakedown/tools/`:

| Tools | Pinned in | Size |
|---|---|---|
| PHP_CodeSniffer, the standards, PHPStan, Theme Check | [`php-tools/composer.lock`](../../php-tools/composer.lock) | about 60 MB |
| ESLint, Stylelint and the WordPress configs | [`js-tools/package-lock.json`](../../js-tools/package-lock.json) | about 180 MB |

You do not install any of these yourself, and a copy you already have is not used. The JavaScript and CSS tools are installed only when the target has a JavaScript or CSS file to check.

When PHP, Composer or npm is missing, the engine is skipped and the report says why. The run does not fail.

| Variable | Use |
|---|---|
| `WP_SHAKEDOWN_PHP` | Path to the PHP binary, when it is not on your `PATH`. `bundled` runs the PHP engines on a PHP that wp-shakedown downloads |
| `WP_SHAKEDOWN_COMPOSER` | Path to Composer |
| `WP_SHAKEDOWN_NPM` | Path to npm |
| `WP_SHAKEDOWN_WORDFENCE_KEY` | API key for Wordfence Intelligence, used by the `vulnerabilities` engine |
| `WP_SHAKEDOWN_WP` | Path to WP-CLI, used by the `site-health` engine |
| `WP_SHAKEDOWN_HOME` | Folder for tools and reports, in place of `~/.wp-shakedown` |

### Without PHP

```bash
WP_SHAKEDOWN_PHP=bundled npx wp-shakedown run ./my-theme
```

With `WP_SHAKEDOWN_PHP=bundled` the PHP engines run on the WebAssembly PHP 8.4 of WordPress Playground (`@php-wasm/node`), with nothing else installed.

| | |
|---|---|
| First run | npm downloads the runtime, about 160 MB, and Composer comes from getcomposer.org. Composer then fetches the PHP tools, which takes a few minutes |
| Disk | About 470 MB for the runtime in `~/.wp-shakedown/tools/` |
| Speed | Two to three times slower than PHP on the machine |
| Findings | The same as with PHP on the machine |

Under the bundled PHP, `php-lint` checks files in batches, `wpcs` and `php-compat` leave out the PHPCS syntax sniff that `php-lint` covers, and `phpstan` runs in one process. `site-health` still needs WP-CLI with a PHP of its own. See [ADR 0025](../adr/0025-bundled-php-is-opt-in.md).

## php-lint

Runs `php -l` on every `.php` file. PHP_CodeSniffer reports nothing for a file it cannot parse, so this engine is the one that catches a broken file.

It checks the syntax of the PHP version that runs it, and the progress output names that version. Code that parses on your PHP and fails on an older one is the job of `php-compat`.

Every finding is an `error` in the `correctness` category, with the rule `syntax`.

## theme-check

Runs [Theme Check](https://wordpress.org/plugins/theme-check/), the checks that wordpress.org runs on every theme upload. It runs on themes only.

Theme Check is a WordPress plugin. Its checks read the theme as text, so the engine runs them with plain PHP and gives them the few WordPress functions they call. WordPress is not involved, and no file of the theme runs as code. See [ADR 0017](../adr/0017-theme-check-without-wordpress.md).

Theme Check puts a label on each message. The engine turns the label into a severity:

| Label | Severity |
|---|---|
| `REQUIRED` | `error` |
| `WARNING` | `warning` |
| `RECOMMENDED`, `INFO` | `info` |

The rule is the name of the check, for example `bad-things`, `plugin-territory` or `style-css-header`. Most findings are in the `correctness` category, so the report lists each one. Forbidden functions, iframes and escaping are `security`. Text domains are `i18n`. Deprecated functions and version headers are `compatibility`.

A check that searches the code gives a file and a line. A check that looks for something missing, such as `wp_head()` or `readme.txt`, gives no location.

For a block theme, Theme Check leaves out the checks for classic templates. For a child theme it also reads the parent theme when the parent folder sits next to the theme. When it does not, the engine says so, and checks that look for template code may report it missing.

Under the [`envato`](presets.md#envato) preset the engine runs the fork of Theme Check that Envato keeps for ThemeForest. See [ADR 0023](../adr/0023-the-envato-profile-swaps-the-theme-check-release.md).

Theme Check wants the folder name to match the theme name, as it does on wordpress.org. A theme in a folder with another name gets a warning about its text domain.

## review

The rules of wp-shakedown itself, in one engine. It runs on themes and plugins, reads files and needs no PHP. A rule is here only when no maintained tool covers it and Theme Check, the WordPress Coding Standards and the other engines do not repeat it.

The engine starts at level 3. Each rule has its own:

- `kinds`: whether the rule runs on themes, plugins or both.
- `level`: the lowest level of a run that runs the rule.
- `directories`: the directory requirements the rule states, `wporg` for wordpress.org and `envato` for ThemeForest. A rule with directories runs when the preset names one of them, as `wporg-theme`, `wporg-plugin` and `envato` do, or when the level is 10. A rule without directories runs for every preset at its level. See [presets](presets.md#directory-rules).

The rules that reviewers of the theme directory raise come from a study of 878 reviews on the Trac of wordpress.org: what reviewers ask authors to change, and how often. [What theme reviewers ask for](../explanation/theme-review-feedback.md) describes the study and its limits. The hint of such a finding says how often reviewers raise the point. The rules are heuristics, so no finding is an error.

| Rule | Kinds | Level | Directories | Finds |
|---|---|---|---|---|
| `font-file-missing` | theme | 3 | none | A `fontFace` `src` in `theme.json` or a style variation that starts with `file:./` and points to a file the theme does not have |
| `font-family-unloaded` | theme | 3 | none | A font family that the theme selects, with no `fontFace` and no generic family at the end of its stack |
| `creates-site-data` | theme | 5 | none | A callback on `after_switch_theme` or `after_setup_theme`, or code behind a first-run option guard, that creates posts, terms, menus, attachments, widgets or front page options, or installs fonts |
| `notice-not-dismissible` | theme, plugin | 5 | none | An admin notice with no `is-dismissible` class and no dismiss handler |
| `placeholder-content` | theme | 5 | none | Real-looking e-mail addresses and links to `#` in templates and patterns |
| `minified-without-source` | theme, plugin | 5 | none | A `.min.js` or `.min.css` file with no file of the same name without `.min` in the project |
| `font-source-missing` | theme | 7 | wporg | `readme.txt` names a font the theme ships but gives no URL for its source |
| `features-locked` | theme, plugin | 7 | wporg, envato | An `if` or `elseif` on a license check whose body returns, exits, removes hooks, loads files or registers features |
| `asset-licenses` | theme | 7 | wporg, envato | Images and fonts that `readme.txt` does not credit, and fonts with no license file |
| `plugin-territory` | theme | 7 | wporg, envato | SEO metadata, mail, public AJAX actions and REST routes |
| `untranslated-text` | theme | 7 | wporg, envato | Text in a PHP template that no translation function wraps |
| `text-in-template` | theme | 7 | wporg | Text in an HTML template of a block theme, where it cannot be translated |
| `readme-headers` | theme | 7 | wporg | A readme with the wrong name, missing header lines, values that differ from `style.css`, no changelog |
| `tested-up-to` | theme | 7 | wporg | A `Tested up to` header behind the latest WordPress |
| `skip-link` | theme | 7 | wporg | No skip link in a classic theme, no `main` element in a block theme |
| `pot-missing` | theme | 7 | wporg | A theme that says it is ready for translation and has no `.pot` file |
| `readme-copyright` | theme | 7 | wporg | No copyright notice that names the theme, or a license file without the GPL text |
| `link-underline` | theme | 7 | wporg | Links without underline in `theme.json` |
| `customizer-textareas` | theme | 7 | wporg | More than three textarea controls in the Customizer |
| `footer-copyright` | theme | 7 | wporg | A copyright line that names the theme or its author |
| `remote-fonts` | theme | 7 | wporg | Fonts loaded from another server |
| `demo-content` | theme | 7 | wporg | Demo import hooks and content the theme creates |
| `activation-redirect` | theme | 7 | wporg | A redirect inside an `after_switch_theme` callback or an `if` on `$_GET['activated']` |
| `readme-not-english` | theme | 7 | wporg | A `readme.txt` that is mostly non-ASCII letters, or long text with almost no common English words. Severity is `info` |

The rules leave these checks to others:

- `font-file-missing` and `font-family-unloaded` do not repeat `wp-json`, which reports schema errors in `theme.json`. A theme selects a family when `var(--wp--preset--font-family--<slug>)` or `var:preset|font-family|<slug>` appears in the `styles` of `theme.json` or of a style variation, or in a file in `templates/`, `parts/` or `patterns/`. A generic family is `serif`, `sans-serif`, `monospace`, `cursive`, `fantasy`, `system-ui`, `ui-serif`, `ui-sans-serif`, `ui-monospace`, `ui-rounded`, `math`, `emoji` or `fangsong`. The rules report a problem once per file and family or path.
- `font-source-missing` wants the URL on the line that names the font or on the next one. A font that `readme.txt` does not mention is left to `asset-licenses`, which also checks the license files of fonts. `remote-fonts` reports fonts loaded from other hosts, such as Google Fonts.
- `creates-site-data` does not repeat Theme Check or WPCS, which do not look at what a hook callback writes. It does not repeat `demo-content`, which reports import hooks, `wp_insert_user` and `wp_create_category` anywhere. A line that `demo-content` reports is not reported again. It ignores `set_theme_mod` for the theme's own settings, `add_theme_support`, `register_*` calls and `flush_rewrite_rules`. It follows a named callback into any file of the theme, but not a function that the callback calls.
- `activation-redirect` does not repeat Theme Check or WPCS, which have no check for redirects after activation. WPCS only asks for `wp_safe_redirect` instead of `wp_redirect`.
- `notice-not-dismissible` does not repeat Theme Check or WPCS, which never read the markup of an admin notice. It reads callbacks on `admin_notices`, `all_admin_notices` and `network_admin_notices`, in PHP strings and in inline HTML. It finds where a callback ends by its braces and treats every quote as the start of a PHP string, so an apostrophe in HTML printed outside PHP, as in `Don't`, can move that end.
- `minified-without-source` runs on every theme and plugin. Whatever the project, a minified file that ships without its source cannot be read or changed.
- `readme-not-english` does not repeat `readme-headers`, which checks the layout of the file and not its language. It skips URLs and code.

`tested-up-to` asks wordpress.org for the latest version and is left out when that fails.

Reviewers also raise points that files do not show, such as keyboard focus and menus that do not work. Those are not in the engine.

### features-locked

Finds code that stops theme or plugin features until the user enters a purchase code, license key or activation. A notice about missing activation is fine. Limiting what the product does is not, and both ThemeForest and wordpress.org reject it.

The rule strips comments, then reads each `if` and `elseif`. A condition counts as a license check when it contains `purchase_code`, `purchase-code`, `license`, `licence`, `is_activated`, `is_registered`, `activation_status`, `activated`, `envato_api`, `envato_token`, `verify_purchase`, or `item_id` together with `envato`, in any case. Quoted option names count, as in `get_option( 'mytheme_license_key' )`.

The body is the brace block or the next statement. It is a gate when it has `return`, `exit`, `die`, `wp_die(`, `remove_action(`, `remove_filter(`, `deactivate_plugins(` or `switch_theme(`, or when it loads or registers features: `require`, `include`, `add_action(` and `add_filter(`, `register_block_type(`, `register_post_type(`, `register_taxonomy(`, `add_theme_support(` or `add_shortcode(`. A hook on `admin_notices`, `network_admin_notices` or `all_admin_notices` and the code inside functions in the body do not count. A body that only prints a message, sets a variable or enqueues a notice script has no finding.

The rule matches text, so it has limits:

- It checks only the `if` body. It does not read the `else` branch of a negated check, so `if ( ! $license ) { ... } else { require ... }` has no finding.
- It does not follow a check through a helper, a variable or a ternary.
- A condition with a license word that has nothing to do with activation can match, for example a check on the license of a library.
- A file with a line over 500 characters near the top, and `.min.php` files, are skipped as generated.

## wpcs

Runs the `WordPress-Extra` standard. If the folder has its own ruleset (`.phpcs.xml`, `phpcs.xml`, `.phpcs.xml.dist` or `phpcs.xml.dist`), the engine uses that file and nothing else.

When the theme or plugin has a `Text Domain` header, the engine passes it to WPCS, which then reports translation calls with another text domain as `WordPress.WP.I18n.TextDomainMismatch`. A project ruleset sets its own text domain, so the engine passes nothing then.

The engine also passes a prefix, so `WordPress.NamingConventions.PrefixAllGlobals` reports functions, classes, constants and hooks that do not start with it. It finds the prefix in the code. It collects the names of top-level functions, classes, interfaces, traits, enums and constants, the names given to `define()`. Hook names do not count: a theme fires hooks of other plugins, such as WooCommerce in its template overrides. Methods, comments and names that start with `wp_`, `_`, `get_`, `the_`, `is_`, `esc_`, `admin_` or `do_` do not count. The prefix is the longest run of leading `_` segments, at least three characters long, that starts at least three names and at least 60% of all names. `twenty_twenty_one_setup` and `Twenty_Twenty_One_SVG_Icons` give `twenty_twenty_one`. The engine prints the prefix in a note. When no prefix qualifies, or the folder has its own ruleset, the engine passes none and WPCS skips the check.

### Escaping switched off

WPCS honours its own ignore comments. A `phpcs:ignore`, `phpcs:disable` or `@codingStandardsIgnore` comment that lists no sniffs, or lists `WordPress.Security.EscapeOutput` or a parent of it, hides unescaped output from the check. The engine reads every PHP file for such comments and reports each one that covers output (`echo`, `print`, `printf`, `vprintf`, `_e`, `_ex`, `exit`, `die`, `<?=`) as the rule `escaping-suppressed`, category `security`. A comment with a reason after `--` is a note. A comment without one is a warning. A `phpcs:ignore` on a line of its own covers the next line, a `phpcs:disable` covers the lines up to its `phpcs:enable`. A project ruleset does not turn this off. See [ADR 0029](../adr/0029-no-taint-engine-yet.md) for why wp-shakedown has no taint analysis.

### Plugins

For a plugin the engine adds the review ruleset of [Plugin Check](https://wordpress.org/plugins/plugin-check/), the tool that wordpress.org runs on every submission. That ruleset brings its own sniffs, such as the one for shortened URLs, and it sets the level that plugin reviewers use. A missing nonce check is an error in WPCS and a warning for a plugin.

This is the part of Plugin Check that reads code. Its checks that need a running WordPress are not included. See [ADR 0012](../adr/0012-plugin-check-rules-inside-wpcs.md).

The rule of a finding is the PHPCS sniff code, for example `WordPress.Security.EscapeOutput.OutputNotEscaped`.

### Category and severity

WPCS reports a missing space at the same level as unescaped output. The engine sorts sniffs into categories and lowers the severity of style findings, so they cannot fail a run. See [ADR 0011](../adr/0011-style-findings-do-not-fail-a-run.md).

| Sniffs | Category | PHPCS error becomes | PHPCS warning becomes |
|---|---|---|---|
| `WordPress.Security.*`, `WordPress.DB.PreparedSQL*`, `PluginCheck.Security.*` | `security` | `error` | `warning` |
| `WordPress.WP.I18n.*` | `i18n` | `error` | `warning` |
| `WordPress.DB.DirectDatabaseQuery`, `WordPress.DB.SlowDBQuery` | `performance` | `error` | `warning` |
| Other `WordPress.WP`, `.PHP`, `.DB`, `.DateTime`, `.CodeAnalysis`, `.Utils` sniffs, `PluginCheck.CodeAnalysis.*`, and a few generic ones about risky PHP | `correctness` | `error` | `warning` |
| Everything else: whitespace, braces, naming, Yoda conditions | `standards` | `warning` | `info` |

A finding that `phpcbf` can fix says so in its hint.

## php-compat

Runs PHPCompatibilityWP against the lowest PHP version the code claims to support. The engine reads that version from the `Requires PHP` header in `style.css`, in the main plugin file, or in `readme.txt`. Without a header it checks against PHP 7.4.

PHPCompatibilityWP knows which newer PHP functions WordPress provides on older versions, so it does not report those.

The engine uses a pre-release of PHPCompatibility. The last stable release is from 2019 and does not know PHP 8 syntax such as `match` or `enum`.

Every finding is in the `compatibility` category. A PHPCS error stays an `error`.

## phpstan

Runs PHPStan at level 5 with the WordPress extension and stubs, so it knows the WordPress functions and what they return.

The rule of a finding is the PHPStan error identifier, for example `function.notFound` or `argument.type`.

Every finding is a `warning` in the `correctness` category. PHPStan sees one theme or plugin at a time. A call to a function from another plugin looks like a call to a function that does not exist, so the engine does not rank its findings as errors.

The engine uses its own settings. If the project has a PHPStan config, the engine says so and does not read it.

PHPStan reports nothing else once a file fails to parse. The engine leaves such files out and runs again, and `php-lint` reports them.

## wp-json

Validates JSON files against the schemas that WordPress publishes on schemas.wp.org:

| File | Schema |
|---|---|
| `theme.json` in a theme, and every `.json` file under `styles/` | `theme.json` |
| Every `block.json` | `block.json` |

If the file names a schema version in `$schema`, such as `https://schemas.wp.org/wp/6.8/theme.json`, the engine uses that version. Otherwise it uses the current one.

A file that is not valid JSON gives an `error` with the rule `json.syntax`. A schema mismatch gives a `warning` with a rule such as `schema.additionalProperties`. The message starts with the path inside the file, for example `/settings/color: "pallete" is not a known property`. WordPress ignores a setting it does not know, so a typo in a name fails without a sign.

The findings have no line number.

## eslint

Runs ESLint with the recommended config of `@wordpress/eslint-plugin` on `.js`, `.jsx`, `.mjs` and `.cjs` files.

The config knows the browser globals, jQuery, `wp` and `ajaxurl`. Formatting rules are off, and so are the rules that check imports against a `package.json`.

| Rules | Category | Severity |
|---|---|---|
| A file that does not parse | `correctness` | `error` |
| `jsx-a11y/*` | `accessibility` | `warning` |
| `@wordpress/i18n-*` | `i18n` | `warning` |
| `no-var`, `prefer-const`, `jsdoc/*` and other rules about how code is written | `standards` | `info` |
| Everything else, such as `no-undef`, `no-unused-vars`, `react-hooks/*` | `correctness` | `warning` |

A parse error is the only `error`. ESLint sees one file at a time, so a variable that PHP hands to the script through `wp_localize_script` looks undefined. A warning is the right level for a finding the tool cannot be sure of.

The engine uses its own config. A config in the project is not read.

## stylelint

Runs Stylelint with `@wordpress/stylelint-config` on `.css` files and with its SCSS variant on `.scss` files.

| Rules | Category | Severity |
|---|---|---|
| A file that does not parse | `correctness` | `error` |
| Unknown properties, units and at-rules, invalid values, duplicate selectors and properties, empty blocks | `correctness` | `warning` |
| Everything else: naming, empty lines, named colors | `standards` | `info` |

## Install health

The install engines run when the target is a WordPress folder. `integrity`, `updates` and `vulnerabilities` ask public services, as below. `config`, `suspicious-files` and `site-health` send nothing.

### What they send

`integrity`, `updates` and `vulnerabilities` ask public services about the software they find. A request holds a plugin or theme slug and a version number. It holds no path, no site name and nothing from `wp-config.php`.

| Engine | Asks |
|---|---|
| `integrity` | api.wordpress.org and downloads.wordpress.org for checksums |
| `updates` | api.wordpress.org for current versions |
| `vulnerabilities` | wpvulnerability.net, and wordfence.com when you set a key |

Answers are cached under `~/.wp-shakedown/cache/` for 12 hours, checksums for 30 days. Without a network and without a cached answer the engine is skipped. `config` sends nothing.

### integrity

Compares every core file with the checksums that wordpress.org publishes for that version and language.

| Rule | Severity | Meaning |
|---|---|---|
| `core.modified` | `error` | A core file differs from the official release |
| `core.missing` | `warning` | A core file is not there |
| `core.unexpected` | `warning` | A file in `wp-admin` or `wp-includes` that is not part of core |
| `plugin.modified` | `error` | A plugin file differs from the wordpress.org release of that version |
| `plugin.missing` | `warning` | A plugin file is not there |

A changed core file is the usual trace of a hacked site, and of a developer who edited core by hand. Plugins that are not on wordpress.org have no checksums, and the engine says how many it could not compare. Themes have no checksums at all.

The `readme.txt` or `readme.md` at the top of a plugin is left out. wordpress.org lets authors change it without a release, so its checksum often differs from the file a site has. WP-CLI leaves it out of `wp plugin verify-checksums` for the same reason.

### updates

| Rule | Severity | Meaning |
|---|---|---|
| `core.outdated` | `warning` | A newer WordPress exists |
| `plugin.outdated`, `theme.outdated` | `warning` | A newer release exists on wordpress.org |
| `plugin.abandoned`, `theme.abandoned` | `warning` | No release in two years |
| `plugin.closed` | `warning` | wordpress.org closed the plugin |

A plugin or theme that is not on wordpress.org gives no finding. The engine cannot know its current version.

### vulnerabilities

Looks up WordPress itself and every plugin and theme in [WPVulnerability.net](https://www.wpvulnerability.net/), a free database that needs no key. A known vulnerability that affects the installed version is an `error`. The finding names it, links to its record and says which version fixes it.

To also use [Wordfence Intelligence](https://www.wordfence.com/threat-intel/), create a free API key in your Wordfence account under Integrations and set it:

```bash
export WP_SHAKEDOWN_WORDFENCE_KEY=your-key
```

The engine then downloads the Wordfence feed once every 12 hours and adds what WPVulnerability did not report. A vulnerability with the same CVE is listed once. If Wordfence rejects the key or cannot be reached, the engine says so and goes on with WPVulnerability.

A finding from Wordfence carries its copyright notice, as the Wordfence terms require.

### config

Reads `wp-config.php` and looks for files that do not belong in a web folder. It never prints a value from `wp-config.php`.

| Rule | Severity | Meaning |
|---|---|---|
| `config.salts` | `error` | The secret keys are missing, short or still the default |
| `config.writable` | `error` | Every user on the machine can write to `wp-config.php` |
| `config.debug` | `warning` | `WP_DEBUG` is on |
| `config.file-edit` | `info` | The code editor in the dashboard is on |
| `leftover.config-copy` | `error` | A copy such as `wp-config.php.bak`, which a server sends as plain text |
| `leftover.dump` | `error` | A database dump in the root or in `wp-content` |
| `leftover.tool` | `warning` | `phpinfo.php`, `adminer.php`, an installer |
| `leftover.env` | `warning` | An `.env` file in the root |
| `leftover.debug-log` | `warning` | `wp-content/debug.log` |
| `uploads.php` | `error` | A PHP file in `wp-content/uploads` |

### suspicious-files

Reads the PHP files in the WordPress root and in `wp-content`, and any file in `wp-content` that holds a PHP open tag, and looks for what a healthy install does not have. It sends nothing and writes nothing. `config` already reports PHP files in `wp-content/uploads`, copies of `wp-config.php`, dumps and `debug.log`, and `integrity` reports extra files in `wp-admin` and `wp-includes`. This engine does not repeat those. It skips `node_modules` and `.git`, files over 2 MB and anything past 20000 files, and says so in a note.

| Rule | Severity | Meaning |
|---|---|---|
| `obfuscated-code` | `error` | `eval(` with `base64_decode(`, `gzinflate(`, `gzuncompress(`, `str_rot13(` or `strrev(` in one statement. `assert(` or `create_function(` with a superglobal. `preg_replace` with the `/e` modifier. Four or more `chr()` calls joined with dots. A variable name written as `${"\x..."}` |
| `remote-code` | `error` | `eval`, `include`, `require`, `system`, `shell_exec`, `passthru`, `exec`, `popen`, `proc_open` or a backtick command that takes `$_GET`, `$_POST`, `$_REQUEST`, `$_COOKIE` or `$_SERVER['HTTP_...']` as its argument |
| `webshell-name` | `error` | A PHP file named like a known web shell: `wso`, `c99`, `r57`, `alfa`, `b374k`, `adminer` or `filesman`, with an optional version suffix. `adminer` in a plugin folder is fine, and `adminer.php` in the root is a `leftover.tool` finding of `config` |
| `hidden-php` | `warning` | A PHP file whose name starts with a dot, or a file with an image extension that holds `<?php` |
| `long-encoded-string` | `warning` | A line of more than 5000 characters that is more than 90 percent base64 characters, in a PHP file outside `vendor` and `node_modules`. A `data:...;base64,` URI does not count |
| `php-in-root` | `warning` | A PHP file in the WordPress root that is not one of the core files and not `wp-config.php` |

Each file gets at most one finding per rule, at the first line that matches. The core root files come from a fixed list, not from the checksums, so the engine needs no network.

Limits: the rules are patterns, not a malware scanner. A clean file can match, for example a security plugin that quotes a shell in its own code, and malware that avoids these patterns passes. A signature database finds far more. Wordfence CLI is the open source scanner with one, but Wordfence has stopped issuing new licenses for it, and its free version reached end of life on 14 October 2026, so a tool cannot rely on it. The signature terms are not published next to the code, so wp-shakedown does not bundle or fetch them. See the [Wordfence CLI repository](https://github.com/wordfence/wordfence-cli).

### site-health

Starts WordPress with WP-CLI and runs tests of Site Health, the screen under Tools in the WordPress admin. The report shows what that screen would show.

| Test | Looks at |
|---|---|
| `autoloaded_options` | The size of the options WordPress loads on every request |
| `scheduled_events` | Cron events that are late or failed |
| `plugin_version`, `theme_version` | Inactive plugins and themes |
| `php_extensions`, `php_default_timezone`, `php_sessions` | The PHP setup WordPress needs |
| `sql_server` | The version of the database server |
| `ssl_support`, `file_uploads`, `debug_enabled`, `persistent_object_cache` | Settings of PHP and WordPress |

A critical result of Site Health is a `warning` here and a recommendation is an `info`, in the `health` category. The rule is the name of the test.

The engine needs WP-CLI on your `PATH`, or in `WP_SHAKEDOWN_WP`, and a database that answers. Without them it is skipped and the report says why.

WordPress starts without plugins, themes and cron, and the tests run inside a database transaction that is rolled back. The database stays as it was. Tests that call other servers are left out. See [ADR 0024](../adr/0024-site-health-through-wp-cli.md).

## What is skipped

The engines do not look into `vendor`, `node_modules` or folders whose name starts with a dot.

`eslint` and `stylelint` also skip `build`, `dist` and `bower_components`, files that end in `.min.js` or `.min.css`, and generated files. A file counts as generated when it has a line longer than 500 characters near the top, a source map comment at the end, or a `.map` file next to it.
