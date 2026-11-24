# Profiles

A profile runs the engines that matter for one gate. Without a profile, every engine that fits the target runs.

```bash
wp-shakedown run ./my-theme --profile wporg-theme
```

| Profile | For | Engines |
|---|---|---|
| `wporg-theme` | A theme on its way to the wordpress.org theme directory | `php-lint`, `theme-check`, `wpcs`, `php-compat`, `wp-json` |
| `wporg-plugin` | A plugin on its way to the wordpress.org plugin directory | `php-lint`, `wpcs`, `php-compat` |
| `site` | A WordPress folder | `integrity`, `updates`, `vulnerabilities`, `config`, plus `php-lint` and `php-compat` on every theme and plugin |

A profile fits one kind of target. `wporg-theme` on a plugin folder stops with a message and exit code 2.

A profile and `--engine` do not combine. Use one of them.

A profile changes which engines run and nothing else. A finding has the same ID and the same severity with and without a profile, so a baseline file works for both. `--fail-on` still sets the severity that makes the command exit 1.

The report names the profile. The comparison with the last run counts only the engines that ran both times, so a switch of profile does not report findings as fixed.

The [MCP server](mcp.md) takes a profile as an argument of `run_checks`, and the [web page](ui.md) has a Profile list.

## wporg-theme

The theme directory runs Theme Check on every upload. The profile runs it through the [`theme-check`](engines.md#theme-check) engine, with the checks for PHP syntax, PHP versions, `theme.json` and the WordPress Coding Standards.

It leaves out `phpstan`, `eslint` and `stylelint`. They report code quality, which is outside the rules of the directory.

## wporg-plugin

The plugin directory runs Plugin Check on every submission. The profile runs the part of Plugin Check that reads PHP code, inside [`wpcs`](engines.md#plugins), with the checks for PHP syntax and PHP versions.

Plugin Check also reads `readme.txt` and the plugin header. Those checks need a running WordPress and are not part of the profile.

## site

For a WordPress folder that you run and did not write. The profile checks that core and plugin files match the official release, that nothing is behind or has a known vulnerability, and that `wp-config.php` and the web folder hold nothing risky.

On every theme and plugin it checks that the PHP parses and runs on the PHP version the theme or plugin declares. It leaves out code style and static analysis, because that code belongs to other people.
