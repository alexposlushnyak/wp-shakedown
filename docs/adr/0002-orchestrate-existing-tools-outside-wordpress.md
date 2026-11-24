# 0002. Orchestrate existing tools from outside WordPress

- Status: Accepted
- Date: 2026-11-24

## Context and problem statement

WordPress testing is spread over tools that are installed and run one by one: PHPCS with WPCS, PHPStan, Theme Check, Plugin Check, Site Health, WP-CLI commands. Several of them are WordPress plugins, so they live inside the site they judge. There is no single run and no single result.

## Considered options

- Write our own rules and checks
- Build a WordPress plugin that bundles the checks
- A separate process that runs the existing tools and merges their results

## Decision outcome

A separate process that orchestrates existing tools.

The existing tools are maintained by the people who define the standards. Rewriting their rules would mean chasing them forever. Tide, an earlier attempt to score all plugins and themes, stopped being maintained. A plugin would put the tester inside the thing being tested and could not check a broken install.

## Consequences

- The tool depends on upstream releases. Adapters stay thin and versions are pinned.
- Checks against an install are read-only.
- Our own checks are written only where no maintained tool exists.
