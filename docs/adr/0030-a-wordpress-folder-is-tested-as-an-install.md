# 0030. A WordPress folder is tested as an install, not as the code of every theme and plugin in it

- Status: Accepted
- Date: 2026-11-27

## Context and problem statement

Given a WordPress folder, wp-shakedown ran the code engines (WPCS, PHPStan, PHP compatibility and the rest) on every theme and plugin inside it, next to the install engines. A real site holds dozens of plugins written by other people. They return thousands of findings, and the person who runs the check can fix none of them. The report drowned what the install itself needs: an outdated core, a known vulnerability, a changed core file, a file that should not be there.

## Considered options

- Keep running the code engines on every unit, and fold their findings
- Run them on the active theme only
- Run install engines only, and test a theme or a plugin when the user names its own folder

## Decision outcome

A WordPress folder runs install engines only: `integrity`, `updates`, `vulnerabilities`, `config`, `site-health` and `suspicious-files`. The runner creates no jobs for the themes and plugins inside it. To test the code of a theme or a plugin, give its folder.

Folding findings still costs every engine run and still says nothing the owner of the site can act on. The active theme is often a theme the owner bought and cannot change either.

## Consequences

- `suspicious-files` joins the install engines: PHP where no PHP belongs and typical malware patterns.
- The `site` preset lists only install engines.
- The page and the command line no longer group engine lines by theme and plugin. Reports written before this change still read: their findings may carry a `unit`.
