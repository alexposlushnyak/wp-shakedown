# Command line

## run

```
wp-shakedown run <path> [options]
```

`<path>` is a theme folder, a plugin folder or a WordPress folder. The tool works out which one it is:

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
| `--engine <id>` | Runs only this engine. Repeat it for more than one |
| `--out <dir>` | Writes the report to this folder |
| `--baseline <file>` | Uses this baseline file |
| `--fail-on <level>` | Sets the severity that makes the command exit 1: `error`, `warning`, `info` or `never`. The default is `error` |

### Where the report goes

Without `--out`, the report goes to `~/.wp-shakedown/reports/<name>-<hash>/`. The folder name comes from the target, so every run on the same target writes to the same place. The command prints the path of `report.md` when it finishes.

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

A suppressed finding stays in the report under its own heading and does not count toward the exit code. When an entry matches nothing, the report lists it as stale so you can remove it. It does that only after a run where every engine ran, because after a partial run the entry may belong to an engine that did not.

## Other commands

| Command | What it does |
|---|---|
| `wp-shakedown --help` | Prints the usage text |
| `wp-shakedown --version` | Prints the version |
