# 0024. Site Health runs through WP-CLI and leaves the database as it was

- Status: Accepted
- Date: 2026-11-25

## Context and problem statement

The install engines of [ADR 0015](0015-install-health-without-a-running-site.md) read files and ask public services. Some of what Site Health shows needs WordPress itself: the size of autoloaded options, missed cron events, inactive plugins and themes, the PHP extensions WordPress wants, the database server. The tool must never write to the install it tests, and starting WordPress can write: a page load runs cron, and some tests store transients.

## Considered options

- Query the database with SQL of our own
- `wp doctor`, a WP-CLI package with checks of its own
- Start WordPress with WP-CLI and run the tests of Site Health

## Decision outcome

The `site-health` engine runs `php-tools/site-health.php` with `wp eval-file`. The script runs a fixed list of Site Health tests and prints their results as JSON. The tests are the ones WordPress shows on its own Site Health screen, so the tool reports what the site owner would see there.

Four measures keep the database as it was:

- WordPress starts with `--skip-plugins` and `--skip-themes`, so no plugin code runs.
- `DISABLE_WP_CRON` is set before WordPress loads, so no scheduled event runs.
- The list holds only tests that read the site. Tests that ask other servers, or call the site over HTTP, are left out.
- The script opens a database transaction before the tests and rolls it back after them.

SQL of our own would repeat what Site Health already does and drift from it. `wp doctor` is a separate package the user would have to install, and its checks differ from what the site owner sees.

## Consequences

- The engine needs WP-CLI and a database that answers. Without them it is skipped and says why.
- A drop-in such as `object-cache.php` still loads, because drop-ins are not plugins. A persistent object cache could receive what a test writes. The transaction does not cover it.
- The rollback needs a database engine with transactions. InnoDB and SQLite have them. MyISAM tables do not, and the tests on the list do not write there except for transients.
- Site Health rates a local copy of a site as strictly as a live one. Its critical results are warnings in the report and its recommendations are notes.
- The tests that call other servers stay out: the WordPress and PHP version checks, HTTP requests, the REST API, loopback requests, HTTPS and the page cache. The `updates` engine covers the versions.
