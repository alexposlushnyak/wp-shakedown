# Command line

## run

```
wp-shakedown run <path> [options]
```

`<path>` is a theme folder, a plugin folder or a WordPress folder, or a ZIP file of one. The tool unpacks a ZIP file into `~/.wp-shakedown/uploads` first, the same way the [web page](ui.md#adding-a-project) does. It works out what the path is:

| It finds | It treats the path as |
|---|---|
| `wp-includes/version.php` | a WordPress folder |
| `style.css` with a `Theme Name` header | a theme |
| a PHP file with a `Plugin Name` header | a plugin |

In a WordPress folder the tool lists every theme in `wp-content/themes` and every plugin in `wp-content/plugins`, and runs the code checks on each one.

### Options

| Option | What it does |
|---|---|
| `--type <kind>` | Treats the path as `theme`, `plugin` or `install` without looking |
| `--engine <id>` | Runs only this engine. Repeat it for more than one. [Engines](engines.md) lists the IDs |
| `--profile <id>` | Runs the engines for one gate: `wporg-theme`, `envato`, `wporg-plugin` or `site`. See [Profiles](profiles.md). It does not combine with `--engine` |
| `--depth <level>` | Sets how thorough the run is: `quick`, `standard` or `deep`. The default is `standard`. See [Depth](#depth) |
| `--experimental` | Also runs the experimental engines. Today that is [`theme-review`](engines.md#theme-review) |
| `--out <dir>` | Writes the report to this folder |
| `--baseline <file>` | Uses this baseline file |
| `--fail-on <level>` | Sets the severity that makes the command exit 1: `error`, `warning`, `info` or `never`. The default is `error` |

### Depth

| Depth | Runs | For |
|---|---|---|
| `quick` | `php-lint`, `theme-check`, `wp-json`, `config` | A check after every change. It takes seconds |
| `standard` | The quick engines, and `wpcs`, `php-compat`, `eslint`, `stylelint`, `integrity`, `updates`, `vulnerabilities` | The usual run |
| `deep` | Everything, with `phpstan` | Before a release |

[Your own checks](checks.md) name the depth they start at.

A depth and a [profile](profiles.md) combine: the run gets the engines that are in both. `--engine` names engines by hand, and the depth does not filter those.

### Progress

While it runs, the command prints one line per engine to standard error:

```
  php-lint: Checking syntax with PHP 8.4.25.
ok php-lint: 1 finding, 0.2s
ok wpcs: 2 findings, 0.2s
  php-compat: Checking against PHP 7.4 and newer.
ok php-compat: 0 findings, 0.2s
```

An indented line is a note from the engine. An engine that cannot run starts its line with `skipped` and gives the reason. In a WordPress folder each line also names the theme or plugin, for example `ok wpcs theme:aurora: 2 findings, 0.2s`.

The summary and the report path go to standard output.

### Where the report goes

Without `--out`, the report goes to `~/.wp-shakedown/reports/<name>-<hash>/`. Set `WP_SHAKEDOWN_HOME` to use another folder in place of `~/.wp-shakedown`. The folder name comes from the target, so every run on the same target writes to the same place. The command prints the path of `report.md` when it finishes.

The tool refuses a report folder inside the target. It does not write into what it tests.

### Comparing with the last run

If the report folder already holds a report, the tool compares the new run with it. The output and the report then say how many findings are fixed, how many are new and how many are still open.

The comparison covers only the engines that ran in both runs. After `--engine phpcs`, the findings of every other engine are left out. They are not counted as fixed.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | No finding at or above `--fail-on` |
| 1 | At least one finding at or above `--fail-on` |
| 2 | The run itself failed: bad arguments, an unreadable path, or an engine that crashed |

## Baseline file

A baseline silences findings you have decided to keep. Put `wp-shakedown-baseline.json` in the target folder, or pass a file with `--baseline`.

```json
{
  "schema": 1,
  "entries": [
    { "id": "3f2a9c1b7d4e", "reason": "Third-party library, fixed upstream in the next release" }
  ]
}
```

Every entry needs a reason. The tool rejects a baseline with an entry that has none.

A suppressed finding stays in the report under its own heading and does not count toward the exit code. When an entry matches nothing, the report lists it as stale so you can remove it. It does that only after a run where every engine ran, because after a partial run the entry may belong to an engine that did not. For a theme or a plugin that is a run with `--depth deep`.

## Projects

Keep a list of the folders you test, and run them together.

| Command | What it does |
|---|---|
| `wp-shakedown add <path>...` | Puts a theme, a plugin or a WordPress folder on the list. A ZIP file is unpacked first |
| `wp-shakedown list` | Shows the list with the result of each project's last run, with themes, plugins and WordPress folders in separate groups |
| `wp-shakedown remove <project>...` | Takes a project off the list by ID, path or name. A project made from a ZIP file loses its unpacked folder. Its reports stay |
| `wp-shakedown run --all` | Runs every project on the list |
| `wp-shakedown run <path> <path>...` | Runs several folders, on the list or not |

Several projects run at once, three by default. `--jobs <n>` sets how many, from 1 to 8. In a terminal each project has one line that updates while it runs. When the output goes to a file or a pipe, each engine gets a line with the project name in front.

`--engine`, `--profile`, `--depth` and `--fail-on` apply to every project. `--out` and `--baseline` work with one path only. The exit code is the highest one among the runs.

The list is the file `~/.wp-shakedown/projects.json`. The [web page](ui.md) reads the same file. See [ADR 0021](../adr/0021-the-hub-keeps-projects-in-a-file.md).

## Other commands

| Command | What it does |
|---|---|
| `wp-shakedown ui [path]` | Starts the [local web page](ui.md) |
| `wp-shakedown mcp` | Starts the [MCP server](mcp.md) for an AI assistant |
| `wp-shakedown --help` | Prints the usage text |
| `wp-shakedown --version` | Prints the version |
