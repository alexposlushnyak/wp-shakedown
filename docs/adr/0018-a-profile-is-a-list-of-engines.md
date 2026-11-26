# 0018. A profile is a list of engines

- Status: Superseded by [0028](0028-presets-are-files.md)
- Date: 2026-11-24

## Context and problem statement

A full run reports everything every engine finds. Someone who prepares a theme for the wordpress.org directory wants what that directory checks. Someone who looks after a site wants to know whether it is intact and safe, and has no use for the code style of plugins other people wrote.

A profile gives a run that view. The question is how much a profile may change.

## Considered options

- A profile selects engines, changes the severity of rules and sets the exit threshold
- A profile runs everything and filters the findings afterwards
- A profile is a named list of engine IDs for one kind of target

## Decision outcome

A profile is a named list of engine IDs for one kind of target. It changes nothing else.

A finding keeps its ID and its severity under every profile. The baseline file and the comparison between runs depend on both, and they keep working when the user switches profile. `--fail-on` already sets the exit threshold. A filter after a full run would spend time on engines whose findings are then dropped.

## Consequences

- A gate that has checks of its own gets an engine, and the profile lists it. `theme-check` is the first ([ADR 0017](0017-theme-check-without-wordpress.md)).
- A run with a profile is a partial run, like a run with `--engine`. It does not report stale baseline entries.
- A profile and a list of engines do not combine. The tool stops and says so.
- The run result records the profile ID, and the reports print it.
- `wporg-plugin` has no engine of its own. It runs part of what a plugin gets without a profile.
