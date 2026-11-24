# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `theme-check` engine: the checks of the wordpress.org theme directory, run with plain PHP and without WordPress.
- Profiles: `--profile wporg-theme`, `wporg-plugin` or `site` runs the engines for one gate. The `run_checks` tool of the MCP server and the web page take a profile too.
- The report names the profile a run used.
- A wordmark, in the README and on the web page.
- `--depth quick`, `standard` or `deep` sets how thorough a run is.
- Checks of your own: a JSON file in `~/.wp-shakedown/checks/` adds a pattern, a list of files or a command to the run as its own engine, with a setting for what happens when the check itself breaks.
- A list of projects: `add`, `list` and `remove` keep it, and `run --all` or `run` with several paths checks projects in parallel.
- The author and jkdevstudio are credited in the README, in `package.json` and at the foot of the web page.
- `theme-review`, an experimental engine for themes: sixteen rules for what reviewers of the wordpress.org theme directory ask for most, taken from a study of 878 reviews. It runs with `--experimental`, and the `wporg-theme` profile includes it then.

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

[Unreleased]: https://github.com/alexposlushnyak/wp-shakedown/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/alexposlushnyak/wp-shakedown/releases/tag/v0.1.0
