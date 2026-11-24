# Engines

An engine runs one external tool and turns its output into findings. Five engines exist. All five run on a theme or a plugin, and on every theme and plugin inside a WordPress folder.

| ID | Tool | Finds |
|---|---|---|
| `php-lint` | `php -l` | PHP syntax errors |
| `wpcs` | PHP_CodeSniffer with the WordPress Coding Standards, plus the Plugin Check review rules for plugins | Unescaped output, missing nonces, unprepared SQL, translation mistakes, discouraged functions, code style |
| `php-compat` | PHP_CodeSniffer with PHPCompatibilityWP | Code that the declared PHP version cannot run |
| `phpstan` | PHPStan with the WordPress extension | Calls to functions that do not exist, wrong argument counts and types |
| `wp-json` | JSON Schema validation | Mistakes in `theme.json`, style variations and `block.json` |

Run one engine with `--engine <id>`.

## What they need

The four PHP engines need PHP on your `PATH`. `wpcs`, `php-compat` and `phpstan` also need Composer the first time they run. `wp-json` needs neither. It downloads a schema from schemas.wp.org and keeps it for a week.

On that first run the tool installs PHP_CodeSniffer, the standards and PHPStan into `~/.wp-shakedown/tools/`. The versions are pinned in [`php-tools/composer.lock`](../../php-tools/composer.lock). You do not install PHPCS or the standards yourself, and a copy you already have is not used.

When PHP or Composer is missing, the engine is skipped and the report says why. The run does not fail.

| Variable | Use |
|---|---|
| `WP_SHAKEDOWN_PHP` | Path to the PHP binary, when it is not on your `PATH` |
| `WP_SHAKEDOWN_COMPOSER` | Path to Composer |
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

## What is skipped

The engines do not look into `vendor`, `node_modules` or folders whose name starts with a dot.
