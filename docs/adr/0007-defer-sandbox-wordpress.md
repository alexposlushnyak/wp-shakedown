# 0007. Defer the disposable WordPress sandbox

- Status: Accepted
- Date: 2026-11-24

## Context and problem statement

Some checks need a running WordPress: Plugin Check, Theme Check, activation tests, a crawl of test content. The tool could start a disposable WordPress by itself, for example with WordPress Playground, mount the theme or plugin, and throw the site away afterwards.

## Considered options

- Build the sandbox into the core
- Leave it out and work only with what is already on disk
- Defer it as a possible separate module

## Decision outcome

Deferred. The tool works with a theme or plugin folder, an existing install and a site URL. It does not start WordPress.

A sandbox is a different kind of feature from running checks and reporting. Keeping it out keeps the core small. It can be added later as a module without changing the core.

## Consequences

- Checks that need a running WordPress run only against an existing install.
- Open question: whether Plugin Check and Theme Check can be loaded through WP-CLI against an existing install without installing them into it. If they cannot, they wait for the sandbox module.
- Activation tests, test-content crawls and live authorization probes wait for the sandbox module.
