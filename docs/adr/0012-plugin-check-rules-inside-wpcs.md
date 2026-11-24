# 0012. The Plugin Check review rules run inside the wpcs engine

- Status: Accepted
- Date: 2026-11-24

## Context and problem statement

Plugin Check is the tool wordpress.org runs on every plugin submission. It is a WordPress plugin, so it needs a running WordPress, and [ADR 0007](0007-defer-sandbox-wordpress.md) defers that. Its code-reading part is a PHPCS ruleset with a few sniffs of its own, and that part runs without WordPress.

Most sniffs in that ruleset are WPCS sniffs that the `wpcs` engine already runs, at a different level. WPCS reports a missing nonce check as an error. The review ruleset reports it as a warning, because the sniff fires on every read of `$_POST`.

## Considered options

- A separate `plugin-check` engine that runs the review ruleset
- A separate engine, with duplicates removed after the run
- One PHPCS run in `wpcs` with a ruleset that references `WordPress-Extra` first and the review ruleset second

## Decision outcome

For a plugin, `wpcs` runs a generated ruleset that references `WordPress-Extra` and then the Plugin Check review ruleset.

PHPCS merges the two. Each sniff runs once, the later reference sets the level, and the Plugin Check sniffs are added. Two engines would report the same line twice with two levels. Removing duplicates after the run would make a run with `--engine` differ from a full run, and the comparison between runs would then report findings as fixed that only moved to the other engine.

## Consequences

- A plugin and a theme with the same code get different levels for some findings. That matches how the two are reviewed.
- There is no engine ID for Plugin Check. Its sniffs show up as rules that start with `PluginCheck.`.
- A project with its own PHPCS ruleset gets that ruleset and not the review rules.
- The review ruleset comes from the Plugin Check repository at a pinned tag, through a `package` entry in `php-tools/composer.json`. Dependabot does not update that entry, so a new Plugin Check release is a manual bump.
- The checks of Plugin Check that need a running WordPress stay out until the sandbox module exists.
