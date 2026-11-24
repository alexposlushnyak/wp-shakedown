# Engines

An engine runs one external tool and turns its output into findings. Three engines exist. All three run on a theme or a plugin, and on every theme and plugin inside a WordPress folder.

| ID | Tool | Finds |
|---|---|---|
| `php-lint` | `php -l` | PHP syntax errors |
| `wpcs` | PHP_CodeSniffer with the WordPress Coding Standards | Unescaped output, missing nonces, unprepared SQL, translation mistakes, discouraged functions, code style |
| `php-compat` | PHP_CodeSniffer with PHPCompatibilityWP | Code that the declared PHP version cannot run |

Run one engine with `--engine <id>`.

## What they need

All three need PHP on your `PATH`. `wpcs` and `php-compat` also need Composer the first time they run.

On that first run the tool installs PHP_CodeSniffer and the standards into `~/.wp-shakedown/tools/`. The versions are pinned in [`php-tools/composer.lock`](../../php-tools/composer.lock). You do not install PHPCS or the standards yourself, and a copy you already have is not used.

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

Runs the `WordPress-Extra` standard. If the folder has its own ruleset (`.phpcs.xml`, `phpcs.xml`, `.phpcs.xml.dist` or `phpcs.xml.dist`), the engine uses that file.

The rule of a finding is the PHPCS sniff code, for example `WordPress.Security.EscapeOutput.OutputNotEscaped`.

### Category and severity

WPCS reports a missing space at the same level as unescaped output. The engine sorts sniffs into categories and lowers the severity of style findings, so they cannot fail a run. See [ADR 0011](../adr/0011-style-findings-do-not-fail-a-run.md).

| Sniffs | Category | PHPCS error becomes | PHPCS warning becomes |
|---|---|---|---|
| `WordPress.Security.*`, `WordPress.DB.PreparedSQL*` | `security` | `error` | `warning` |
| `WordPress.WP.I18n.*` | `i18n` | `error` | `warning` |
| `WordPress.DB.DirectDatabaseQuery`, `WordPress.DB.SlowDBQuery` | `performance` | `error` | `warning` |
| Other `WordPress.WP`, `.PHP`, `.DB`, `.DateTime`, `.CodeAnalysis`, `.Utils` sniffs, and a few generic ones about risky PHP | `correctness` | `error` | `warning` |
| Everything else: whitespace, braces, naming, Yoda conditions | `standards` | `warning` | `info` |

A finding that `phpcbf` can fix says so in its hint.

## php-compat

Runs PHPCompatibilityWP against the lowest PHP version the code claims to support. The engine reads that version from the `Requires PHP` header in `style.css`, in the main plugin file, or in `readme.txt`. Without a header it checks against PHP 7.4.

PHPCompatibilityWP knows which newer PHP functions WordPress provides on older versions, so it does not report those.

The engine uses a pre-release of PHPCompatibility. The last stable release is from 2019 and does not know PHP 8 syntax such as `match` or `enum`.

Every finding is in the `compatibility` category. A PHPCS error stays an `error`.

## What is skipped

The engines do not look into `vendor`, `node_modules` or folders whose name starts with a dot.
