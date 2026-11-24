# Engines

An engine runs one external tool and turns its output into findings. Seven engines exist. All seven run on a theme or a plugin, and on every theme and plugin inside a WordPress folder.

| ID | Tool | Finds |
|---|---|---|
| `php-lint` | `php -l` | PHP syntax errors |
| `wpcs` | PHP_CodeSniffer with the WordPress Coding Standards, plus the Plugin Check review rules for plugins | Unescaped output, missing nonces, unprepared SQL, translation mistakes, discouraged functions, code style |
| `php-compat` | PHP_CodeSniffer with PHPCompatibilityWP | Code that the declared PHP version cannot run |
| `phpstan` | PHPStan with the WordPress extension | Calls to functions that do not exist, wrong argument counts and types |
| `wp-json` | JSON Schema validation | Mistakes in `theme.json`, style variations and `block.json` |
| `eslint` | ESLint with the WordPress config | Undefined variables, React hook mistakes, accessibility and translation problems in JavaScript |
| `stylelint` | Stylelint with the WordPress config | Unknown properties, invalid values and duplicate selectors in CSS and SCSS |

Run one engine with `--engine <id>`.

## What they need

The four PHP engines need PHP on your `PATH`. `wpcs`, `php-compat` and `phpstan` also need Composer the first time they run. `wp-json` needs neither. It downloads a schema from schemas.wp.org and keeps it for a week. `eslint` and `stylelint` need npm, which comes with Node.js.

On the first run the tool installs what the engines need into `~/.wp-shakedown/tools/`:

| Tools | Pinned in | Size |
|---|---|---|
| PHP_CodeSniffer, the standards, PHPStan | [`php-tools/composer.lock`](../../php-tools/composer.lock) | about 60 MB |
| ESLint, Stylelint and the WordPress configs | [`js-tools/package-lock.json`](../../js-tools/package-lock.json) | about 180 MB |

You do not install any of these yourself, and a copy you already have is not used. The JavaScript and CSS tools are installed only when the target has a JavaScript or CSS file to check.

When PHP, Composer or npm is missing, the engine is skipped and the report says why. The run does not fail.

| Variable | Use |
|---|---|
| `WP_SHAKEDOWN_PHP` | Path to the PHP binary, when it is not on your `PATH` |
| `WP_SHAKEDOWN_COMPOSER` | Path to Composer |
| `WP_SHAKEDOWN_NPM` | Path to npm |
| `WP_SHAKEDOWN_HOME` | Folder for tools and reports, in place of `~/.wp-shakedown` |

## php-lint

Runs `php -l` on every `.php` file. PHP_CodeSniffer reports nothing for a file it cannot parse, so this engine is the one that catches a broken file.

It checks the syntax of the PHP version that runs it, and the progress output names that version. Code that parses on your PHP and fails on an older one is the job of `php-compat`.

Every finding is an `error` in the `correctness` category, with the rule `syntax`.

## wpcs

Runs the `WordPress-Extra` standard. If the folder has its own ruleset (`.phpcs.xml`, `phpcs.xml`, `.phpcs.xml.dist` or `phpcs.xml.dist`), the engine uses that file and nothing else.

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

## What is skipped

The engines do not look into `vendor`, `node_modules` or folders whose name starts with a dot.

`eslint` and `stylelint` also skip `build`, `dist` and `bower_components`, files that end in `.min.js` or `.min.css`, and generated files. A file counts as generated when it has a line longer than 500 characters near the top, a source map comment at the end, or a `.map` file next to it.
