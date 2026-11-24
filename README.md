# wp-shakedown

One local test run for WordPress themes, plugins and installs, with one report at the end.

> **Status:** in development. There is nothing to install yet.

## Why

Testing WordPress work means running PHPCS, PHPStan, WP-CLI checks, Site Health and more, each installed and run on its own. wp-shakedown runs them from one place and merges the results.

## What it does

- Runs existing, trusted tools. It adds its own checks only where no tool exists.
- Works outside WordPress. Nothing is installed into the site it tests.
- Writes one report, structured so an AI assistant can fix what was found.

## What it checks

| Target | Checks |
|---|---|
| Theme or plugin folder | Coding standards, static analysis, PHP compatibility, `theme.json` and `block.json` |
| WordPress install | Core and plugin integrity, configuration, outdated or vulnerable plugins and themes |
| Site URL | Accessibility, performance, broken links |

## How you run it

From the terminal, from a local web page, or from an AI assistant over MCP. All three use the same core.

## Documentation

- [Architecture](docs/explanation/architecture.md)
- [Decision records](docs/adr/README.md)
- [All docs](docs/README.md)

## Development

This project is built with AI assistance, in the open. [AGENTS.md](AGENTS.md) describes how. Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[GPL-2.0-or-later](LICENSE). Free, with no paid tier.
