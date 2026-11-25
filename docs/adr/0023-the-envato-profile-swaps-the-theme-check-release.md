# 0023. The envato profile runs Envato's fork inside the theme-check engine

- Status: Accepted
- Date: 2026-11-25

## Context and problem statement

Envato keeps a fork of Theme Check for ThemeForest. Its readme says reviewers run it on every submission. The fork has the structure of Theme Check, so the script from [ADR 0017](0017-theme-check-without-wordpress.md) runs it with one more stand-in function. About forty of its sixty checks are the same files as upstream. Twenty differ, and one is new: a list of patterns Envato rejects.

A theme author works toward one gate at a time. The question is how the fork enters a run.

## Considered options

- A second engine, `envato-theme-check`, that runs next to `theme-check`
- A second engine that runs only when a profile or the user names it
- The `theme-check` engine runs the fork when the run uses the `envato` profile

## Decision outcome

The `theme-check` engine runs Envato's fork under the `envato` profile and the wordpress.org release otherwise. The engine learns the profile from its context.

Two engines side by side would report the forty shared checks twice. An engine that runs only on request would need a new kind of switch, and every run without it would count as incomplete for the baseline file.

One engine with two releases keeps the engine ID. A finding of a shared check has the same ID under both profiles, so one baseline entry covers both.

## Consequences

- The engine run records the variant it ran. The comparison between runs leaves an engine out when the variants differ, so a switch between `wporg-theme` and `envato` does not report the checks of the other release as fixed.
- The findings of Envato's own check carry the rule `themeforest`, after the class name in the fork.
- The fork is pinned to a commit of its repository through a `package` entry in `php-tools/composer.json`. It has no releases. Dependabot does not update that entry.
- The fork is behind upstream in places. It lacks checks that the wordpress.org release has, such as the spelling of WordPress.
- A baseline entry for a `themeforest` finding shows as stale after a complete run without the profile.
- Envato reviewers also judge design and code quality by hand. The profile covers what their tool reports.
