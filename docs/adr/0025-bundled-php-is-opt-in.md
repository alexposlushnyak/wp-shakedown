# 0025. The bundled PHP is opt-in, through WP_SHAKEDOWN_PHP

- Status: Accepted
- Date: 2026-11-25
- Refines: [ADR 0006](0006-php-runtime-user-choice.md)

## Context and problem statement

[ADR 0006](0006-php-runtime-user-choice.md) lets the user choose between the PHP on the machine and a bundled WebAssembly runtime, once the bundled one is shown to run PHP_CodeSniffer and PHPStan on real projects.

A test with `@php-wasm/node` 3.1.66, the PHP of WordPress Playground, ran every PHP tool of wp-shakedown and got the same findings as the PHP on the machine: PHPCS with three standards, PHPStan at level 5, Theme Check and the Envato fork. It also showed the cost. The first use downloads about 160 MB and takes about 470 MB on disk. Composer needs about two minutes to fetch the tools through the network layer of the runtime. Runs are two to three times slower, and PHPStan runs without its parallel workers.

ADR 0006 speaks of a choice at setup, stored in a config. `npx wp-shakedown` has no setup step, and the tool has no config file.

## Considered options

- Fall back to the bundled PHP when no PHP is found
- Ask on the first run
- An environment variable, `WP_SHAKEDOWN_PHP=bundled`

## Decision outcome

The user turns the bundled PHP on with `WP_SHAKEDOWN_PHP=bundled`. Without it, the PHP engines need PHP on the machine as before, and their skip message names the variable.

A silent fallback would start a 160 MB download in a run that someone expected to take seconds. A question on the first run does not work for the MCP server or for CI. `WP_SHAKEDOWN_PHP` already names the PHP to use, so the bundled one is one more value of the same setting.

## Consequences

- `php-wasm/` holds a package manifest, a lock file and the runner script. The runtime is installed with npm into `~/.wp-shakedown/tools/` on first use, like the JavaScript tools ([ADR 0013](0013-javascript-and-css-tools.md)). The package gets no new dependency.
- Composer comes as `composer.phar` from getcomposer.org, pinned by version and checksum, and runs on the bundled PHP. wp-shakedown registers the PHPCS standards itself, because the Composer plugin that does it cannot run there.
- Under the bundled PHP, `php-lint` checks files in batches, `wpcs` and `php-compat` leave out the PHPCS syntax sniff that `php-lint` covers, and `phpstan` runs in one process.
- `site-health` still needs WP-CLI and the PHP it runs on.
- CI does not download the runtime. A test runs the bundled path when `WP_SHAKEDOWN_TEST_BUNDLED=1` is set.
