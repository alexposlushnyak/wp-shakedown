# Your own checks

You can add checks to the run. A check is one JSON file in `~/.wp-shakedown/checks/`. Each file becomes an engine with the ID `custom:<file name>`, with its own line in the progress output and in the report.

```
~/.wp-shakedown/checks/
  no-var-dump.json
  has-changelog.json
  unit-tests.json
```

The file name is the name of the check: lowercase letters, digits and hyphens.

The tool reads checks from that folder only. It never reads a check from the folder it tests, so a theme you downloaded cannot make the tool run a command. See [ADR 0020](../adr/0020-user-checks-live-in-the-home-folder.md).

## Three types

### pattern

Searches files for a regular expression.

```json
{
  "type": "pattern",
  "title": "No var_dump left",
  "files": "**/*.php",
  "forbid": "\\bvar_dump\\s*\\(",
  "message": "var_dump() is left in the code."
}
```

`forbid` gives one finding per line that matches, with the file and the line. `require` gives one finding when no file matches. Use one of the two.

### files

Looks at which files exist.

```json
{
  "type": "files",
  "require": ["readme.txt", "languages/*.pot"],
  "forbid": ["**/*.zip", "**/*.log"]
}
```

Each `require` pattern must match a file. Each file that matches a `forbid` pattern is a finding.

### command

Runs a command in the folder under test. The check fails when the exit code is not the expected one.

```json
{
  "type": "command",
  "title": "Unit tests",
  "kinds": ["plugin"],
  "paths": ["/Users/you/work/my-plugin"],
  "run": "composer test",
  "timeoutSeconds": 300,
  "level": 8,
  "onError": "skip"
}
```

The finding carries the last lines of the output as its hint. The command gets the path of the folder in `WP_SHAKEDOWN_TARGET`.

## Fields

| Field | Default | Meaning |
|---|---|---|
| `type` | required | `pattern`, `files` or `command` |
| `title` | the file name | Name shown in the progress output |
| `kinds` | `["theme", "plugin"]` | What the check runs on: `theme`, `plugin`, `install`. A WordPress folder runs only the checks of kind `install` |
| `paths` | every path | Glob patterns for the absolute path of the folder you run the tool on. The check runs only where one matches |
| `level` | `6` | The lowest [level](cli.md#levels) that runs the check, an integer from 0 to 10 |
| `depth` | none | The old name of `level`: `quick`, `standard` or `deep`, which are 3, 6 and 8. `level` wins when a file has both |
| `severity` | `error` | `error`, `warning` or `info` |
| `category` | `other` | A [category](report.md#finding) |
| `message` | depends on the type | Text of the finding. Required for `pattern` |
| `hint` | none | How to fix it |
| `onError` | `fail` | What happens when the check itself cannot run |

Fields of one type:

| Type | Field | Meaning |
|---|---|---|
| `pattern` | `files` | One glob pattern or a list |
| `pattern` | `forbid` or `require` | The regular expression, in JavaScript syntax |
| `pattern` | `flags` | Flags for the expression, for example `i` |
| `files` | `require`, `forbid` | Lists of glob patterns |
| `command` | `run` | The command, run through your shell |
| `command` | `expectExit` | The exit code that means success. The default is 0 |
| `command` | `timeoutSeconds` | The default is 120 |

A field the format does not know makes the file invalid. A typo in a field name then shows up at once.

## When the check itself breaks

A check can break without finding anything: the regular expression is wrong, the command does not exist, or it runs past its timeout. `onError` says what happens then.

| Value | Result |
|---|---|
| `fail` | The engine is marked failed and the command exits 2. The report is incomplete, and it says so |
| `skip` | The engine is marked skipped with the reason. The run goes on as if the check was not there |
| `warn` | The run gets one warning that says why the check could not run |

One check that breaks does not stop the others. Each check is its own engine.

A file that is not valid JSON, or does not fit the format, shows as a failed engine with the reason.

## Glob patterns

Patterns match the path relative to the folder under test, with `/` between folders.

| Pattern | Matches |
|---|---|
| `*.zip` | A zip file in the top folder |
| `**/*.zip` | A zip file in any folder |
| `inc/**` | Everything under `inc` |
| `*.{js,css}` | Files that end in `.js` or `.css` |

Checks do not look into `node_modules`, `vendor` or folders whose name starts with a dot. A `pattern` check skips files larger than 2 MB.

## Running one check

```bash
wp-shakedown run ./my-theme --engine custom:no-var-dump
```
