# 0019. Depth is a filter on engines

- Status: Superseded by [0027](0027-levels-0-to-10.md)
- Date: 2026-11-24

## Context and problem statement

A run takes from a second to a few minutes, and reports from a handful of findings to thousands. The user wants to choose how thorough a run is, from a light pass to the full one, with a clear scope at each level.

## Considered options

- Each depth changes how engines work, for example a higher PHPStan level at the deepest one
- Each depth is a set of engines, and an engine works the same at every depth

## Decision outcome

There are three depths: `quick`, `standard` and `deep`. Each engine names the lightest depth that runs it, and a depth runs every engine at or below it. `standard` is the default.

| Depth | Adds |
|---|---|
| `quick` | `php-lint`, `theme-check`, `wp-json`, `config` |
| `standard` | `wpcs`, `php-compat`, `eslint`, `stylelint`, `integrity`, `updates`, `vulnerabilities` |
| `deep` | `phpstan` |

An engine that works the same at every depth gives a finding the same ID and the same severity each time. The comparison between runs counts only engines that ran both times, so it stays correct when the depth changes. A PHPStan level that depends on the depth would report findings as fixed after a switch from `deep` to `standard`.

## Consequences

- `phpstan` no longer runs by default. It is the slowest engine and reports warnings only.
- A profile and a depth combine: the run gets the engines that are in both.
- `--engine` names engines by hand, and the depth does not filter those.
- A check the user writes names its depth the same way ([ADR 0020](0020-user-checks-live-in-the-home-folder.md)).
- Stale baseline entries are reported only when the depth left out no engine that fits the target. For a theme or a plugin that is a `deep` run. A lighter run cannot tell whether an entry belongs to an engine it skipped.
