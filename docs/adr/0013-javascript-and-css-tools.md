# 0013. JavaScript and CSS tools are installed on first use and run with our config

- Status: Accepted
- Date: 2026-11-24

## Context and problem statement

ESLint, Stylelint and the WordPress configs for them are npm packages. Installed together they take about 180 MB. A theme or plugin may also ship its own lint config, built files next to source files, and third-party scripts.

Out of the box the WordPress ESLint config reported WordPress-style spacing as a formatting error, because Prettier ran without the WordPress Prettier config. It also linted a minified bundle as if someone had written it by hand.

## Considered options

- Make ESLint and Stylelint dependencies of the package
- Install them on first use into the tool's folder, as with the PHP tools
- Use the lint setup of the project when it has one

## Decision outcome

The package ships `js-tools/package.json`, its lock file and two config files. The first run on a target that has JavaScript or CSS installs them with `npm ci` into `~/.wp-shakedown/tools/js-<hash>`. The engines always use our two config files.

As dependencies, the tools would add 180 MB to every install, including for people who only check PHP. A project's own config needs the project's own plugins, which may not be installed, and then two people get different reports for the same code. This matches [ADR 0010](0010-install-php-tools-with-composer.md).

The config turns off formatting rules and the import rules that need a `package.json`. The engines skip minified and generated files.

## Consequences

- `npm ci` runs with `--ignore-scripts`, so no package runs an install script on the user's machine.
- The folder name includes a hash of the lock file and both configs. A change to any of them installs a fresh set.
- A finding from these engines is a warning at most, unless the file does not parse. ESLint cannot see a global that PHP passes to a script.
- A project that relies on its own lint rules does not get them here.
- TypeScript files are not checked yet.
