# 0027. A run has a level from 0 to 10

- Status: Accepted
- Date: 2026-11-26
- Supersedes: [0019](0019-depth-is-a-filter-on-engines.md)

## Context and problem statement

Three depths were too coarse. `standard` held seven engines that differ a lot in cost and in what they ask of a project, and `deep` held one. A preset such as the Theme Check of wordpress.org needs a stop between `standard` and `deep`: the rules of the directories sit above the linters and below static analysis. The checks that exist only for a few narrow cases have no place at all.

## Considered options

- Keep three depths and add a fourth
- A scale from 0 to 10, where each engine names the lowest level that runs it
- A list of engine groups the user switches on one by one

## Decision outcome

A run has a level, an integer from 0 to 10. Each engine has a `level`, the lowest level that runs it, and a run at a level runs every engine at or below it. The default is 6. A run without options runs what a `standard` run ran before.

The scale follows what a project needs to clear. Level 7 is what the WordPress.org handbook requires. Levels 8 and 9 are for narrow cases and for what trac tickets show reviewers ask for. Level 10 is everything.

| Level | Engines added |
|---|---|
| 0 | `php-lint` |
| 1 | `wp-json` |
| 2 | `config` |
| 3 | `theme-check` |
| 4 | `integrity`, `updates`, `vulnerabilities`, `site-health` |
| 5 | `wpcs`, `php-compat` |
| 6 | `eslint`, `stylelint` |
| 7 | `theme-review`, `activation-lock` |
| 8 | `phpstan` |
| 9, 10 | none yet |

`quick`, `standard` and `deep` stay as names for 3, 6 and 8. `--depth` and the `depth` field of a check file stay as aliases of `--level` and `level`. `parseLevel` reads either form and rejects anything else.

An engine works the same at every level, as in 0019, so a finding keeps its ID and its severity and the comparison between runs counts only engines that ran both times. A rule inside an engine may still depend on the level. The engine gets the level of the run in its context as `level` and can skip its own rules above it. No engine does that yet. It exists so that an engine with one cheap rule and one slow rule does not need to become two engines.

An experimental engine still runs when the user turns experimental checks on. `theme-review` has level 7 and keeps its `experimental` mark, so it runs at level 7 and above without the switch, and below that only with `--experimental` or by name.

## Consequences

- `theme-review` now runs by default at level 7 and above. The presets of the directories have level 7, so they run it without `--experimental`.
- A run at the default level leaves out the same engines as before, and also `theme-review` and `activation-lock`, which sit at 7.
- A preset and a level combine as in 0019: the run gets the engines that are in both. `--engine` names engines by hand, and the level does not filter those.
- Stale baseline entries are reported only when the level left out no engine that fits the target. For a theme or a plugin that is a run at level 8 or higher.
- The run result records `level`. A report written before levels records `depth`, and the reader maps `quick`, `standard` and `deep` to 3, 6 and 8, and a missing depth to 6.
- Levels 9 and 10 are empty until an engine needs them.
