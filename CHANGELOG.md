# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A Docker image with PHP, Composer, Node and every tool installed: `ghcr.io/alexposlushnyak/wp-shakedown`. See [Run wp-shakedown in Docker](docs/how-to/docker.md).
- `wp-shakedown install-tools` installs the PHP tools and the JavaScript and CSS tools ahead of the first run.
- `wp-shakedown ui --bind <address>` for a container. The default stays 127.0.0.1.
- Playwright tests of the web page, and the test suite runs on macOS and Windows as well as Linux.
- A base of review cases in `cases/`: requests that wordpress.org reviewers make, each with its ticket, a status and a fixture theme. A test runs every case, so a rule that stops catching one fails the build. See [ADR 0035](docs/adr/0035-a-base-of-review-cases.md).
- A GitHub Action: `uses: alexposlushnyak/wp-shakedown@<tag>` runs the checks, uploads the findings to code scanning, keeps the report as an artifact and writes the short report to the job summary. [Run wp-shakedown in CI](docs/how-to/ci.md) also shows GitLab CI and Bitbucket Pipelines.
- `wp-shakedown.json` in a theme, plugin or WordPress folder sets the preset or engines, the level and the exit threshold for every run on it. It cannot hold checks or commands, or turn on an assistant. `--no-config` ignores it. See [ADR 0034](docs/adr/0034-settings-file-in-the-target.md).
- Checks for an assistant: a run on a theme or plugin lists the checks no tool can make, such as whether escaping fits its context or a request handler checks the nonce, each with a prompt and the files to start from. `wp-shakedown assist` and the web page answer them through Claude Code, Codex or an Anthropic API key, when the preset names one in its new `assistant` field. Without it nothing leaves your machine. `wp-shakedown key set anthropic` saves the key. See [ADR 0033](docs/adr/0033-assistant-checks-and-providers.md).
- The MCP server has `list_presets`, `list_runs`, `get_run` and `get_assistant_checks`.
- The report folder keeps the 20 newest runs. `wp-shakedown history <project>` lists them, prints the report of any one and compares any two. The web page lists the runs of a project, opens the report of each and compares two. See [ADR 0032](docs/adr/0032-run-history-is-a-folder-per-run.md).
- `report-short.md` with the summary and the critical and important findings grouped by rule, and `report.csv` with one row per finding.
- `report.md` and `report.html` list a rule that repeats across files once, with its fix, and then every place it was found.
- `wpcs` passes the prefix most global names of a theme or plugin share, so WPCS reports functions, classes, constants and hooks without it.
- `wpcs` reports the phpcs comments that switch off the escaping check on output, as `escaping-suppressed`: a warning without a reason, a note with one. See [ADR 0029](docs/adr/0029-no-taint-engine-yet.md).
- `review`, one engine for the rules of wp-shakedown on themes and plugins. Each rule has its own level, and the rules a directory requires run when the preset sets `directory` to `wporg` or `envato`. New rules: font files in `theme.json` that do not exist, fonts a theme selects but never loads, fonts the readme names without a source URL, features locked until a purchase code or license key is entered, a theme that creates content or settings when it is activated, a redirect after activation, admin notices that cannot be dismissed, and a readme that is not in English. Every `.min.js` and `.min.css` of a theme or plugin needs its unminified file. See [ADR 0031](docs/adr/0031-one-review-engine-and-directory-rules.md).
- `suspicious-files`, an engine for a WordPress folder: obfuscated code, request input fed to `eval` or a shell, file names of known web shells, PHP hidden in images or dot files, long encoded strings and unknown PHP files in the root.
- `npm run tools:check` and a weekly workflow keep Theme Check, Envato Theme Check, the Plugin Check rules and the bundled PHP current. See [Update the tools](docs/how-to/update-tools.md).
- The web page opens the folder dialog of your system to add a project: Finder on macOS, the folder browser on Windows, zenity or kdialog on Linux. The folder list and the path field stay as a second way.
- ZIP files of themes, plugins and WordPress sites: upload one or several on the web page, or drop them on it, and their runs start in the queue. `wp-shakedown add` and `run` take a ZIP file too. A newer archive of the same theme replaces the old one and the runs compare.
- The web page and `wp-shakedown list` group projects into themes, plugins and WordPress folders.
- A dock at the bottom of the web page with the way home, the run status and the ways to add a project. Screens change with a short fade.
- Levels from 0 to 10 replace the three depths. `--level 7` runs every engine that sits at level 7 or lower. `quick`, `standard` and `deep` work as 3, 6 and 8, and the default is 6. `--depth` still works. A check file takes `level` as well as `depth`. See [ADR 0027](docs/adr/0027-levels-0-to-10.md).
- Presets replace profiles and carry a level and an exit threshold. `wp-shakedown presets` lists them. You can write your own as JSON files in `~/.wp-shakedown/presets`. The web page and the local server create and remove them. See [ADR 0028](docs/adr/0028-presets-are-files.md).
- The `client` preset, for a theme or a plugin made for a client or sold outside the directories: the WordPress standards, PHP versions, `phpstan`, ESLint and Stylelint.
- The web page has a Presets screen: it lists the built-in presets and yours, copies a built-in one, and edits the engines, the level and the exit threshold of your own.
- The web page sets the level with a slider from 0 to 10.

### Changed

- The terminal output, the reports and the MCP server call the severities Critical, Important and Recommended. The summary line reads `2 critical, 19 important, 32 recommended.` JSON and SARIF keep `error`, `warning` and `info`.
- `--fail-on` takes `critical`, `important`, `recommended` or `never`, and still takes `error`, `warning` and `info`.
- `--preset` replaces `--profile`, and `--level` replaces `--depth`. The old options, the `profile` and `depth` arguments of `run_checks` and of the local server, and the `profile` and `depth` fields of old reports still work. The reports and `wp-shakedown list` show the level and the preset.
- `wporg-theme`, `envato` and `wporg-plugin` run at level 7, `site` at level 6. A preset sets the level and the exit threshold of a run unless you pass `--level` or `--fail-on`.
- A WordPress folder is tested as an install: `integrity`, `updates`, `vulnerabilities`, `config`, `site-health` and `suspicious-files`. The code engines no longer run on every theme and plugin inside it. Test a theme or plugin by giving its own folder. See [ADR 0030](docs/adr/0030-a-wordpress-folder-is-tested-as-an-install.md).
- `theme-review` is now part of `review`, and its findings get new IDs once. `--experimental` and the `experimental` argument of `run_checks` are old names: they raise the level to at least 7 and, without a preset, turn on the review rules of wordpress.org, as `theme-review` ran before. The page has no experimental switch. A preset that lists an engine that does not exist ignores it.
- The preset field `themeCheck` is now `directory`. A preset file with `themeCheck: "envato"` still works.
- `phpstan` runs at level 8, the old `deep`.
- The web page is dark only, set in Inter, with neutral greys and larger type.
- `report.html` looks like the web page: dark, set in Inter, with the three counts at the top.

### Fixed

- On Windows, the tool could not start npm, Claude Code or Codex when npm installed them, because they are .cmd files. It now runs the script such a file wraps with Node.

## [0.3.0] - 2026-11-25

### Added

- `site-health`, an engine for a WordPress folder: it runs the tests of the Site Health screen through WP-CLI and leaves the database as it was. The `site` profile includes it.
- `wpcs` passes the `Text Domain` header of a theme or plugin to WPCS, which then reports translation calls with another text domain.
- The web page groups the engine lines of a WordPress folder by theme and plugin.
- `WP_SHAKEDOWN_PHP=bundled` runs the PHP engines on the WebAssembly PHP of WordPress Playground, for a machine without PHP. The tool downloads it, and Composer, on the first run.

### Fixed

- `integrity` no longer reports the `readme.txt` of a plugin as modified. wordpress.org changes it without a release.
- A link to one project of the web page that carries the token opens that project, not the list.
- The wordmark in the README follows the theme of GitHub. It used to follow the theme of the system, and a light GitHub page in a dark system showed a white wordmark on white.

## [0.2.0] - 2026-11-25

### Added

- `theme-check` engine: the checks of the wordpress.org theme directory, run with plain PHP and without WordPress.
- Profiles: `--profile wporg-theme`, `envato`, `wporg-plugin` or `site` runs the engines for one gate. The `run_checks` tool of the MCP server and the web page take a profile too, and the report names it.
- Under the `envato` profile, `theme-check` runs the version of Theme Check that Envato keeps for ThemeForest.
- `theme-review`, an experimental engine for themes: sixteen rules for what reviewers of the wordpress.org theme directory ask for most, taken from a study of 878 reviews. It runs with `--experimental`, and the `wporg-theme` profile includes it then.
- `--depth quick`, `standard` or `deep` sets how thorough a run is.
- Checks of your own: a JSON file in `~/.wp-shakedown/checks/` adds a pattern, a list of files or a command to the run as its own engine, with a setting for what happens when the check itself breaks.
- A list of projects: `add`, `list` and `remove` keep it, and `run --all` or `run` with several paths checks projects in parallel.
- A wordmark, in the README and on the web page.
- The author and jkdevstudio are credited in the README, in `package.json` and at the foot of the web page.

### Changed

- The web page is a hub: it lists the projects, runs up to three at once and shows each run live. It shows counts and no longer lists findings. A button opens the HTML report.
- `phpstan` runs at `--depth deep` and no longer by default.
- Stale baseline entries are reported only by a run that left out no engine.

## [0.1.0] - 2026-11-24

The first release.

### Three ways to run it

- `wp-shakedown run <path>` detects a theme, a plugin or a WordPress folder, runs the engines and prints one progress line per engine.
- `wp-shakedown ui` opens a local web page to pick a folder, start a run, watch each engine and read the findings.
- `wp-shakedown mcp` is an MCP server for AI assistants, with tools to detect a target, list the engines, run the checks and page through the findings.

### Engines for a theme or a plugin

- `php-lint`: PHP syntax errors.
- `wpcs`: PHP_CodeSniffer with the WordPress Coding Standards, or with the project's own ruleset. For plugins it adds the review rules of Plugin Check.
- `php-compat`: PHPCompatibilityWP against the `Requires PHP` version.
- `phpstan`: PHPStan at level 5 with the WordPress extension.
- `wp-json`: `theme.json`, style variations and `block.json` against the WordPress schemas.
- `eslint`: JavaScript with the WordPress ESLint config.
- `stylelint`: CSS and SCSS with the WordPress Stylelint config.

### Engines for a WordPress folder

A WordPress folder gets the engines above for every theme and plugin in it, and four more:

- `integrity`: core and plugin files against the official checksums.
- `updates`: outdated, abandoned and closed software.
- `vulnerabilities`: known vulnerabilities from WPVulnerability.net, and from Wordfence Intelligence with an API key.
- `config`: risky settings in `wp-config.php` and files that should not be in a web folder.

### Report

- Reports in Markdown, JSON, SARIF and HTML, written outside the target.
- Finding IDs that stay the same between runs.
- Comparison with the previous run on the same target.
- A baseline file for silencing findings, with a required reason per entry.
- Style findings rank below errors and are counted per rule in the Markdown report.

### Tools

- The PHP tools install themselves with Composer on the first run, and the JavaScript and CSS tools with npm. Versions are pinned.

[Unreleased]: https://github.com/alexposlushnyak/wp-shakedown/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/alexposlushnyak/wp-shakedown/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/alexposlushnyak/wp-shakedown/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/alexposlushnyak/wp-shakedown/releases/tag/v0.1.0
