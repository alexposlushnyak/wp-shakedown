# 0022. Experimental engines are off until the user turns them on

- Status: Accepted
- Date: 2026-11-24

## Context and problem statement

Theme Check covers the rules of the theme directory that a script can state exactly. Reviewers ask for more than that. A study of 878 recent reviews shows what they raise and how often ([What theme reviewers ask for](../explanation/theme-review-feedback.md)). Many of those points can be seen in the files of a theme, but only with a heuristic: a text that looks untranslated, an image the readme does not seem to list.

A heuristic is wrong some of the time. The other engines report what a maintained tool or an official list says, and a user trusts a run for that reason.

## Considered options

- Add the heuristics to the `theme-check` engine
- A separate engine that always runs, with low severities
- A separate engine that is marked experimental and runs only when the user asks

## Decision outcome

An engine can be marked experimental. The runner leaves such an engine out unless the user turns experimental checks on with `--experimental`, or names the engine with `--engine`. `theme-review` is the first one. The `wporg-theme` profile lists it, so the profile runs it when the switch is on.

No finding of `theme-review` is an error. Each one links to the study and says how often reviewers raise the point.

Mixed into `theme-check`, a heuristic would look like a rule of the directory. An engine that always runs would put guesses into every report, and the user could not tell a new guess from a new problem when comparing runs.

## Consequences

- A default run reports the same findings as before.
- The report says when experimental checks were on.
- A run without them is not complete in the sense of the baseline file: it does not report stale entries, because an entry may belong to the engine that was left out.
- The rules need upkeep. Reviewers change what they ask for, and the study has to be repeated to keep the rules current.
- The shares in the hints come from one study and are rough. The study document states its limits.
