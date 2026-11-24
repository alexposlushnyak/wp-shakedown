# Engines

An engine runs one check and turns the result into findings. Twelve engines exist, in two groups. You can add [checks of your own](checks.md).

Eight check code. They run on a theme or a plugin, and on every theme and plugin inside a WordPress folder. `theme-check` runs on themes only.

| ID | Tool | Finds |
|---|---|---|
| `php-lint` | `php -l` | PHP syntax errors |
| `theme-check` | Theme Check, the checks of the wordpress.org theme directory | Missing files and headers, functions a theme must not call, plugin features inside a theme, missing template tags |
| `wpcs` | PHP_CodeSniffer with the WordPress Coding Standards, plus the Plugin Check review rules for plugins | Unescaped output, missing nonces, unprepared SQL, translation mistakes, discouraged functions, code style |
| `php-compat` | PHP_CodeSniffer with PHPCompatibilityWP | Code that the declared PHP version cannot run |
| `phpstan` | PHPStan with the WordPress extension | Calls to functions that do not exist, wrong argument counts and types |
| `wp-json` | JSON Schema validation | Mistakes in `theme.json`, style variations and `block.json` |
| `eslint` | ESLint with the WordPress config | Undefined variables, React hook mistakes, accessibility and translation problems in JavaScript |
| `stylelint` | Stylelint with the WordPress config | Unknown properties, invalid values and duplicate selectors in CSS and SCSS |

Four check a WordPress folder as a whole. They read files and ask public services. WordPress does not have to run, and they need no database and no WP-CLI. See [Install health](#install-health).

| ID | Finds |
|---|---|
| `integrity` | Core and plugin files that differ from the official release |
| `updates` | WordPress, plugins and themes that are behind, abandoned or closed |
| `vulnerabilities` | Known vulnerabilities in the installed versions |
| `config` | Risky settings in `wp-config.php` and files that should not be in a web folder |

A run at the default [depth](cli.md#depth) leaves out `phpstan`, which runs with `--depth deep`. Run one engine with `--engine <id>`. Run the engines for one gate with a [profile](profiles.md).

## What they need

The five PHP engines need PHP on your `PATH`. `theme-check`, `wpcs`, `php-compat` and `phpstan` also need Composer the first time they run. `wp-json` needs neither. It downloads a schema from schemas.wp.org and keeps it for a week. `eslint` and `stylelint` need npm, which comes with Node.js.

On the first run the tool installs what the engines need into `~/.wp-shakedown/tools/`:

| Tools | Pinned in | Size |
|---|---|---|
| PHP_CodeSniffer, the standards, PHPStan, Theme Check | [`php-tools/composer.lock`](../../php-tools/composer.lock) | about 60 MB |
| ESLint, Stylelint and the WordPress configs | [`js-tools/package-lock.json`](../../js-tools/package-lock.json) | about 180 MB |

You do not install any of these yourself, and a copy you already have is not used. The JavaScript and CSS tools are installed only when the target has a JavaScript or CSS file to check.

When PHP, Composer or npm is missing, the engine is skipped and the report says why. The run does not fail.

| Variable | Use |
|---|---|
| `WP_SHAKEDOWN_PHP` | Path to the PHP binary, when it is not on your `PATH` |
| `WP_SHAKEDOWN_COMPOSER` | Path to Composer |
| `WP_SHAKEDOWN_NPM` | Path to npm |
| `WP_SHAKEDOWN_WORDFENCE_KEY` | API key for Wordfence Intelligence, used by the `vulnerabilities` engine |
| `WP_SHAKEDOWN_HOME` | Folder for tools and reports, in place of `~/.wp-shakedown` |

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

Theme Check wants the folder name to match the theme name, as it does on wordpress.org. A theme in a folder with another name gets a warning about its text domain.

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

## Install health

These four engines run when the target is a WordPress folder.

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

### What they do not check

Site Health, autoloaded options, cron and the list of active plugins need WordPress to run. An engine for that is planned.

## What is skipped

The engines do not look into `vendor`, `node_modules` or folders whose name starts with a dot.

`eslint` and `stylelint` also skip `build`, `dist` and `bower_components`, files that end in `.min.js` or `.min.css`, and generated files. A file counts as generated when it has a line longer than 500 characters near the top, a source map comment at the end, or a `.map` file next to it.
