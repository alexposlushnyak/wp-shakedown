# Presets

A preset is a named set of engines with a level, an exit threshold and, when you want one, a directory whose requirements it applies. Without a preset, every engine that fits the target runs at the default [level](cli.md#levels).

```bash
wp-shakedown run ./my-theme --preset wporg-theme
wp-shakedown presets
```

## Built-in presets

| Preset | For | Level | Directory | Engines |
|---|---|---|---|---|
| `wporg-theme` | A theme that has to pass the Theme Check of the wordpress.org theme directory | 7 | `wporg` | `php-lint`, `theme-check`, `review`, `wpcs`, `php-compat`, `wp-json` |
| `envato` | A theme that has to pass the Envato Theme Check of ThemeForest | 7 | `envato` | `php-lint`, `theme-check` with Envato's rules, `review`, `wpcs`, `php-compat`, `wp-json` |
| `wporg-plugin` | A plugin that has to pass the code checks of the wordpress.org plugin directory | 7 | `wporg` | `php-lint`, `wpcs`, `php-compat`, `review` |
| `client` | A theme or plugin made for a client, or sold outside the directories | 8 | none | `php-lint`, `wp-json`, `review`, `wpcs`, `php-compat`, `phpstan`, `eslint`, `stylelint` |
| `site` | A WordPress folder, tested as an install | 6 | none | `integrity`, `updates`, `vulnerabilities`, `config`, `site-health`, `suspicious-files` |

A preset fits one or two kinds of target, and none of them runs code checks on the themes and plugins inside a WordPress folder. Give the folder of a theme or plugin to test it. `wporg-theme` on a plugin folder stops with a message and exit code 2.

A preset and `--engine` do not combine. Use one of them.

A preset picks engines, a level and an exit threshold. It changes nothing about how an engine works. A finding has the same ID and the same severity with and without a preset, so a baseline file works for both.

The level of a preset applies to the run unless you pass `--level`. The preset keeps the level filter: an engine that sits above the level stays out even when the preset lists it. The `failOn` of a preset sets the exit threshold unless you pass `--fail-on`. No built-in preset sets `failOn`.

The report names the preset, the level and the directory. The comparison with the last run counts only the engines that ran both times, so a switch of preset does not report findings as fixed.

The [MCP server](mcp.md) takes a preset as an argument of `run_checks`, and the [web page](ui.md) has a Preset list.

## Your own presets

A preset you write is one JSON file in `~/.wp-shakedown/presets/`. The file name without `.json` is the ID. The ID has lowercase letters, digits and hyphens, up to 41 characters, and cannot be the ID of a built-in preset. `wp-shakedown` never reads a preset from the folder it tests, for the same reason it does not read checks from there ([ADR 0020](../adr/0020-user-checks-live-in-the-home-folder.md)).

```json
{
  "schema": 1,
  "title": "Agency handover",
  "summary": "What we check before a theme goes to the client.",
  "kinds": ["theme"],
  "engines": ["php-lint", "wpcs", "php-compat", "wp-json", "custom:house-rules"],
  "level": 7,
  "failOn": "warning",
  "directory": "wporg"
}
```

| Field | Meaning |
|---|---|
| `schema` | `1` |
| `title`, `summary` | Shown by `wp-shakedown presets`, the MCP server and the web page |
| `kinds` | `theme`, `plugin` or `install`. At least one |
| `engines` | Engine IDs, [your own checks](checks.md) included as `custom:<name>`. An ID that no engine has is ignored, so a preset keeps working when an engine is missing |
| `level` | Optional. An integer from 0 to 10 |
| `failOn` | Optional. `error`, `warning`, `info` or `never`. These are the values of the JSON report. The command line also takes `critical`, `important` and `recommended` |
| `directory` | Optional. `wporg` or `envato`. See [Directory rules](#directory-rules). A file with the old field `themeCheck: "envato"` reads as `directory: "envato"` |

A field the format does not know makes the file invalid. `wp-shakedown presets` lists a file that is not valid after the table, with the reason. Such a file stops only a run that asks for that preset.

The web page and the local server save and remove presets through the same folder. See [Local web page](ui.md).

## Directory rules

wp-shakedown tests WordPress in general. The requirements of wordpress.org and ThemeForest are one scenario, and a preset switches them on with `directory`:

| Value | Directory | Effect |
|---|---|---|
| none | | The [`review`](engines.md#review) engine runs only its rules that apply everywhere |
| `wporg` | wordpress.org | `review` also runs its rules for wordpress.org |
| `envato` | ThemeForest | `review` also runs its rules for ThemeForest, and `theme-check` runs the Envato fork |

A run at level 10 runs every rule of `review`, whatever the directory. The page has a Directory rules list in the preset editor.

## wporg-theme

The theme directory runs Theme Check on every upload. The preset runs it through the [`theme-check`](engines.md#theme-check) engine, with the checks for PHP syntax, PHP versions, `theme.json`, the WordPress Coding Standards and the [`review`](engines.md#review) rules for wordpress.org.

Theme Check covers the rules a script can state exactly. Reviewers ask for more. At level 7 the `review` engine runs the rules for the points reviewers raise most, and the rule that finds features locked behind a license key.

The preset leaves out `phpstan`, `eslint` and `stylelint`. They report code quality, which is outside the rules of the directory.

## envato

Envato keeps its own version of Theme Check for ThemeForest, and its reviewers run it on every theme. Under this preset the [`theme-check`](engines.md#theme-check) engine runs that version in place of the wordpress.org one.

Most checks are the same in both. Envato adds a list of things it rejects: `mkdir()` and mail functions, empty attributes, empty CSS classes written to get past a check, removed core filters, and code that looks like known malware. Those findings have the rule `themeforest`.

The comparison with the last run leaves `theme-check` out when one run used this directory and the other did not, because the two versions differ.

The `review` engine runs the rules that name ThemeForest, plus the rules that apply everywhere.

Envato reviewers also judge design and code quality by hand. The preset covers what their tool reports.

## wporg-plugin

The plugin directory runs Plugin Check on every submission. The preset runs the part of Plugin Check that reads PHP code, inside [`wpcs`](engines.md#plugins), with the checks for PHP syntax and PHP versions, and the `review` rules for wordpress.org that fit a plugin.

Plugin Check also reads `readme.txt` and the plugin header. Those checks need a running WordPress and are not part of the preset.

## client

For a theme or plugin that is not headed for a directory: work for a client, or a product sold on your own site. The preset runs the WordPress standards, the PHP versions the code declares, static analysis with `phpstan`, and the JavaScript and CSS linters. It runs the rules of `review` that apply everywhere, and leaves out the rules that exist only for the directories: Theme Check and the directory rules of `review`.

## site

For a WordPress folder that you run and did not write. The preset tests the install and runs no code checks on the themes and plugins inside it. To test one, give the folder of that theme or plugin. The preset checks that core and plugin files match the official release, that nothing is behind or has a known vulnerability, and that `wp-config.php` and the web folder hold nothing risky.

It leaves out code style and static analysis, because that code belongs to other people.
