# 0006. The user chooses the PHP runtime

- Status: Accepted
- Date: 2026-11-24

## Context and problem statement

PHP_CodeSniffer, PHPStan and the other PHP tools need PHP. Requiring a local PHP install adds a setup step. A PHP runtime compiled to WebAssembly can ship inside the package and needs nothing installed, but it is slower.

## Considered options

- Always require PHP on the machine
- Always use the bundled runtime
- Let the user choose at setup

## Decision outcome

The user chooses at setup: the bundled runtime or the PHP on the machine. The choice is stored in the config and can be changed.

People without PHP want the tool to run with nothing else installed. People who have PHP want the speed.

## Consequences

- Both paths are supported and tested.
- The bundled runtime is offered only after it is confirmed to run PHP_CodeSniffer and PHPStan on real projects. Until then, the tool requires PHP on the machine.
