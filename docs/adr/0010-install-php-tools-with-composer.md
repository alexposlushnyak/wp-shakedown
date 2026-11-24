# 0010. Install the PHP tools with Composer on first run

- Status: Accepted
- Date: 2026-11-24

## Context and problem statement

PHP_CodeSniffer, the WordPress Coding Standards and PHPCompatibilityWP are Composer packages that depend on each other. WPCS 3.4 needs PHP_CodeSniffer 3.13 and does not run on 4.0. The tool has to get a working set onto the machine without asking the user to install and match the packages by hand.

## Considered options

- Use whatever PHPCS the user has installed
- Download each package as an archive and wire the standards together in our own code
- Keep a `composer.json` and a lock file in the package and run `composer install` into a folder the tool owns

## Decision outcome

The package ships `php-tools/composer.json` and `php-tools/composer.lock`. The first engine that needs the tools runs `composer install` into `~/.wp-shakedown/tools/php-<hash of the lock file>`. Later runs reuse that folder.

A PHPCS the user already has may be the wrong version or lack a standard, and then two people get different reports for the same code. Wiring the packages together ourselves would repeat what Composer and the PHPCS installer plugin do, and would break when a package changes its layout. With a lock file every user runs the same versions, and Dependabot can propose updates.

## Consequences

- The first run needs Composer and a network connection. Without Composer the engines are skipped with a message that says how to get it.
- A new lock file gives a new folder name, so an update of the tool installs a fresh set and leaves the old one on disk.
- PHPCompatibilityWP is pinned to a pre-release, because the stable release does not know PHP 8 syntax.
- The tool installs into a temporary folder and renames it, so an interrupted install does not leave a half-filled folder that later runs would trust.
- This is the path for the PHP on the machine. The bundled runtime from [ADR 0006](0006-php-runtime-user-choice.md) needs its own answer.
