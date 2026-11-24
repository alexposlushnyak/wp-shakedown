# wp-shakedown

wp-shakedown runs the usual WordPress checks on a theme, a plugin or a whole WordPress folder from one place and writes one report.

> In development. There is nothing to install yet.

## Why

Testing WordPress work means running PHPCS, PHPStan, WP-CLI checks, Site Health and more. You install each one and run each one by hand. wp-shakedown runs them together and merges the results.

## What it does

- It runs the tools you already use and adds a check of its own only where no tool exists.
- It runs outside WordPress and installs nothing into the site it tests.
- It writes one report that an AI assistant can read and fix from.

## What it checks

| Target | Checks |
|---|---|
| Theme or plugin folder | Coding standards, static analysis, PHP compatibility, `theme.json` and `block.json` |
| WordPress folder | The same code checks across every theme and plugin in it, plus core integrity, configuration, outdated or vulnerable plugins and themes |
| Site URL (separate module) | Accessibility, performance, broken links |

## How you run it

You run it from the terminal, from a local web page, or from an AI assistant over MCP. All three use the same core.

## Documentation

- [Architecture](docs/explanation/architecture.md)
- [Decision records](docs/adr/README.md)
- [All docs](docs/README.md)

## Development

AI agents write most of this project and the maintainer reviews their work. [AGENTS.md](AGENTS.md) describes the process. To contribute, read [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[GPL-2.0-or-later](LICENSE). The tool is free and has no paid tier.
