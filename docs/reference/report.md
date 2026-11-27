# Report format

Each run writes four files with the same content:

| File | For |
|---|---|
| `report.md` | People and AI assistants |
| `report.json` | Programs. This is the full result |
| `report.sarif` | Tools that read SARIF 2.1.0, such as code scanning |
| `report.html` | Reading in a browser |

`report.md` lists every finding except code style. A theme of ordinary size has thousands of style findings, so the Markdown report counts them per rule under "Code style". The other three files hold each one with its file and line.

The types below are in [`src/types.ts`](../../src/types.ts).

## Finding

| Field | Type | Meaning |
|---|---|---|
| `id` | string | 12 hex characters. Stable between runs |
| `engine` | string | The engine that produced it, for example `phpcs` |
| `rule` | string | The engine's own rule name |
| `severity` | `error`, `warning`, `info` | See [Severity names](#severity-names) |
| `category` | `security`, `compatibility`, `standards`, `correctness`, `performance`, `accessibility`, `i18n`, `health`, `other` | |
| `message` | string | What is wrong |
| `location.file` | string | Path relative to the target, with forward slashes |
| `location.line`, `location.column` | number | |
| `location.url`, `location.selector` | string | For findings on a page instead of a file |
| `hint` | string | How to fix it |
| `docs` | string | A URL with more detail |
| `unit` | string | Only in reports from versions that ran the code checks on each theme and plugin of a WordPress folder, as `theme:<folder>` or `plugin:<folder>` |
| `rerun` | string | The command that runs this engine again |
| `suppressed.reason` | string | Set when a baseline entry silences the finding |

Only `id`, `engine`, `rule`, `severity`, `category`, `message`, `location` and `rerun` are always present.

### Severity names

`report.json` and `report.sarif` write the severity as `error`, `warning` or `info`. Everything meant for people uses a name instead: the summary line, `report.md`, `report.html`, the table of `wp-shakedown list`, the progress lines and the text the MCP server returns.

| In JSON and SARIF | Shown as |
|---|---|
| `error` | Critical |
| `warning` | Important |
| `info` | Recommended |

The summary line reads `2 critical, 19 important, 32 recommended.`

### How the ID is built

The ID is a hash of the engine, the rule, the unit, the file or URL, the selector and the message. The line number is left out, so adding code above a finding does not change its ID. When one file has the same finding more than once, the copies get different IDs in line order. See [ADR 0008](../adr/0008-finding-ids-without-line-numbers.md).

## Run result

`report.json` holds one object:

| Field | Meaning |
|---|---|
| `schema` | `1`. It changes when the format breaks compatibility |
| `tool` | Name and version of wp-shakedown |
| `target` | Kind, path and name of what was tested, and for a WordPress folder the themes and plugins found in it |
| `preset` | ID of the [preset](presets.md) the run used. Absent when it used none |
| `level` | The [level](cli.md#levels) of the run, an integer from 0 to 10 |
| `directory` | `wporg` or `envato` when the preset names a directory, absent otherwise. See [presets](presets.md#directory-rules) |
| `experimental` | Only in reports from versions that had experimental engines. Newer versions do not write it |
| `startedAt`, `finishedAt` | ISO 8601 timestamps |
| `engines` | One entry per engine run: status `ok`, `skipped` or `failed`, duration, number of findings, the reason when it did not run, and the `variant` when the engine ran another version of its tool |
| `findings` | Every finding, sorted by file, then line |
| `summary` | Counts of unsuppressed findings per severity, and the number suppressed |
| `staleBaseline` | IDs of baseline entries that matched nothing |

A report written before levels existed has `depth` (`quick`, `standard` or `deep`) and `profile` in place of `level` and `preset`. The tool reads such a report as level 3, 6 or 8, and as level 6 when `depth` is missing. It reads `profile` as `preset`. The comparison with the last run works across the change.

An engine is `skipped` when it cannot run on this machine, for example when PHP is missing. It is `failed` when it crashed. A failed engine makes the command exit 2, because the report is then incomplete.

## SARIF

Each finding becomes one result. The rule ID is `<engine>/<rule>`, `info` maps to the SARIF level `note`, and the finding ID is in `partialFingerprints` under `wpShakedown/v1`. A suppressed finding carries a `suppressions` entry with the reason.
