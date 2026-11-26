# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The web page opens the folder dialog of your system to add a project: Finder on macOS, the folder browser on Windows, zenity or kdialog on Linux. The folder list and the path field stay as a second way.
- ZIP files of themes, plugins and WordPress sites: upload one or several on the web page, or drop them on it, and their runs start in the queue. `wp-shakedown add` and `run` take a ZIP file too. A newer archive of the same theme replaces the old one and the runs compare.
- The web page and `wp-shakedown list` group projects into themes, plugins and WordPress folders.
- A dock at the bottom of the web page with the way home, the run status and the ways to add a project. Screens change with a short fade.

### Changed

- The web page is dark only, set in Inter, with neutral greys and larger type.

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
