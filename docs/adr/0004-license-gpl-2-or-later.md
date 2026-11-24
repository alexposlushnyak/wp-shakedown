# 0004. License under GPL-2.0-or-later

- Status: Accepted
- Date: 2026-11-24

## Context and problem statement

The tool is free, with no paid tier. It uses GPL-licensed packages from the WordPress project as libraries, and it is meant for the WordPress community.

## Considered options

- MIT
- GPL-2.0-or-later

## Decision outcome

GPL-2.0-or-later.

It is the license of WordPress itself and of the WordPress packages the tool builds on, so there is no compatibility question. MIT would be simpler for reuse but would sit awkwardly on top of GPL dependencies.

## Consequences

- Dependencies must be GPL-compatible.
- Data and rule sets that forbid redistribution are never bundled. They are fetched at run time under the user's own terms, or not used. This applies to the WPScan vulnerability data and the Semgrep registry rules.
