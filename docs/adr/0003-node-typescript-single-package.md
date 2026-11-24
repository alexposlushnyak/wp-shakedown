# 0003. Node.js and TypeScript in one npm package

- Status: Accepted
- Date: 2026-11-24

## Context and problem statement

The tool needs a terminal command, a local web server with a page, and an MCP server, all over one core. It also drives a browser for outside-in checks.

## Considered options

- PHP, distributed through Composer
- Go or Rust, distributed as a binary
- Node.js and TypeScript, distributed through npm

## Decision outcome

Node.js and TypeScript, one package named `wp-shakedown`, with one command of the same name:

- `wp-shakedown run <path>` runs the checks
- `wp-shakedown ui` starts the local web page
- `wp-shakedown mcp` starts the MCP server

Playwright, axe-core, Lighthouse, the MCP SDK and the PHP WebAssembly runtime from the WordPress Playground project are all Node packages, so they can be used as libraries instead of separate installs. PHP would tie the tool to the user's PHP setup. A compiled binary would have to shell out to Node for most engines anyway.

The command is `wp-shakedown`, not `shakedown`, because another WordPress testing package already installs a `shakedown` command.

## Consequences

- Node.js is the only hard requirement.
- PHP tools still need a PHP runtime. See [ADR 0006](0006-php-runtime-user-choice.md).
