# 0015. Install health works from files and public data, without a running site

- Status: Accepted
- Date: 2026-11-24

## Context and problem statement

A WordPress folder gets the same code checks as a single theme or plugin. It also has questions that only make sense for a whole install: are the core files intact, is anything outdated or known to be vulnerable, is the configuration safe.

The usual tools for these questions are WP-CLI commands and Site Health. Both load WordPress, so they need PHP, a database that answers and a site that boots. A folder copied from a server, or a site that is broken, has none of that.

## Considered options

- Call WP-CLI for everything
- Read the files and ask public services, with no WordPress running
- Do both in one engine

## Decision outcome

Four engines read the folder and ask public services:

- `integrity` hashes the files and compares them with the checksums wordpress.org publishes.
- `updates` reads version headers and asks wordpress.org for the current versions.
- `vulnerabilities` asks a vulnerability database about each installed version.
- `config` reads `wp-config.php` and looks for files that should not be in a web folder.

They work on any copy of a WordPress folder, also one that does not boot, and they need nothing but Node.js. That fits [ADR 0002](0002-orchestrate-existing-tools-outside-wordpress.md): the tool stays outside WordPress and only reads.

What needs a running site, such as Site Health and autoloaded options, goes into a separate engine that calls WP-CLI and is skipped when WordPress does not answer.

## Vulnerability data

WPVulnerability.net is the default source. It is free, needs no key and combines several databases. Wordfence Intelligence is an optional second source, switched on by an API key the user creates. The WPScan data is not used: its terms do not allow it in a tool like this, as [ADR 0004](0004-license-gpl-2-or-later.md) records.

## Consequences

- Three of the engines send plugin and theme slugs with version numbers to wordpress.org, wpvulnerability.net and, with a key, wordfence.com. They send no path, no site name and nothing from `wp-config.php`. The reference page says so.
- Answers are cached, so a second run works offline for a while.
- `config` never puts a value from `wp-config.php` into the report. A test checks that a secret key does not show up in a finding.
- The engines cannot tell which plugins are active. They report on everything in the folder.
- Plugins that are not on wordpress.org get no integrity check and no update check.
- The Wordfence path was written from the public documentation of its API and tested against the documented example. It was not run with a real key.
