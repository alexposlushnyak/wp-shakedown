# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- GPL-2.0-or-later license.
- README, architecture document and the first seven decision records.
- `AGENTS.md` as the entry file for AI agents.
- Contributing guide, security policy, issue forms and pull request template.
- Code of conduct (Contributor Covenant 2.0), with reports handled through GitHub.
- `wp-shakedown run <path>`, which detects a theme, a plugin or a WordPress folder and lists the themes and plugins inside a WordPress folder.
- The engine contract and the runner.
- `php-lint` engine: PHP syntax errors.
- `wpcs` engine: PHP_CodeSniffer with the WordPress Coding Standards, or with the project's own ruleset. Style findings rank below errors.
- `php-compat` engine: PHPCompatibilityWP against the `Requires PHP` version.
- `phpstan` engine: PHPStan at level 5 with the WordPress extension.
- `wp-json` engine: `theme.json`, style variations and `block.json` against the WordPress schemas.
- For plugins, `wpcs` adds the review rules of Plugin Check.
- `eslint` engine: JavaScript with the WordPress ESLint config.
- `stylelint` engine: CSS and SCSS with the WordPress Stylelint config.
- The PHP tools install themselves with Composer on the first run.
- Progress lines on standard error while engines run.
- `integrity` engine: core and plugin files against the official checksums.
- `updates` engine: outdated, abandoned and closed software in a WordPress folder.
- `vulnerabilities` engine: known vulnerabilities from WPVulnerability.net, and from Wordfence Intelligence with an API key.
- `config` engine: risky settings in `wp-config.php` and files that should not be in a web folder.
- `wp-shakedown ui`: a local web page to pick a folder, start a run, watch each engine and read the findings.
- Finding IDs that stay the same between runs.
- Reports in Markdown, JSON, SARIF and HTML, written outside the target.
- Comparison with the previous run on the same target.
- Baseline file for silencing findings, with a required reason per entry.
- CI on Node.js 22, 24 and 26.
