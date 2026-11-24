# 0002. Orchestrate existing tools from outside WordPress

- Status: Accepted
- Date: 2026-11-24

## Context and problem statement

To test WordPress work you install and run tools one by one: PHPCS with WPCS, PHPStan, Theme Check, Plugin Check, Site Health, WP-CLI commands. Several of them are WordPress plugins, so they live inside the site they judge. Each tool gives its own result in its own format.

## Considered options

- Write our own rules and checks
- Build a WordPress plugin that bundles the checks
- A separate process that runs the existing tools and merges their results

## Decision outcome

A separate process that orchestrates existing tools.

The people who define the standards maintain these tools. Rewriting their rules would mean tracking every upstream change by hand. Tide, an earlier project that scored plugins and themes, lost its maintainers. A plugin would put the tester inside the site it tests, and it could not check an install that is broken.

## Consequences

- The tool depends on upstream releases. Adapters stay thin and versions are pinned.
- Checks against an install are read-only.
- Our own checks are written only where no maintained tool exists.
