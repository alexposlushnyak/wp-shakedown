<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/wordmark-on-dark.png">
    <img alt="wp-shakedown" src=".github/assets/wordmark-on-light.png" width="360">
  </picture>
</h1>

wp-shakedown runs the usual WordPress checks on a theme, a plugin or a whole WordPress folder from one place and writes one report.

```bash
npx wp-shakedown run ./my-theme
```

## Why

Testing WordPress work means running PHPCS, PHPStan, WP-CLI checks, Site Health and more. You install each one and run each one by hand. wp-shakedown runs them together and merges the results.

## What it does

- It runs the tools you already use and adds a check of its own only where no tool exists.
- It runs outside WordPress and installs nothing into the site it tests.
- It writes one report that an AI assistant can read and fix from.

## What it checks

| Target | Checks |
|---|---|
| Theme or plugin folder | Coding standards, static analysis at the deep level, PHP compatibility, `theme.json` and `block.json`, JavaScript and CSS. For a theme, the Theme Check rules of wordpress.org |
| WordPress folder | The same code checks across every theme and plugin in it, plus file integrity, known vulnerabilities, outdated or abandoned software, and risky settings and files |

A profile runs only what one gate checks: `--profile wporg-theme`, `envato`, `wporg-plugin` or `site`. `--depth quick`, `standard` or `deep` sets how thorough the run is. You can add [checks of your own](docs/reference/checks.md).

## How you run it

| From | Command |
|---|---|
| The terminal | `npx wp-shakedown run <folder>` |
| A page in your browser | `npx wp-shakedown ui` |
| An AI assistant, over MCP | `npx wp-shakedown mcp`, set up once in the assistant |

All three use the same core.

## What you need

- Node.js 22.18 or newer.
- PHP and Composer for the PHP checks. Without them those checks are skipped and the rest still runs.

You do not install PHPCS, PHPStan, ESLint or Stylelint. The first run fetches pinned versions into `~/.wp-shakedown`.

Version 0.1 is tested on macOS and Linux. Windows is not tested yet.

## Documentation

- [Your first run](docs/tutorials/first-run.md)
- [Command line](docs/reference/cli.md)
- [Local web page](docs/reference/ui.md)
- [MCP server](docs/reference/mcp.md)
- [Engines](docs/reference/engines.md)
- [Profiles](docs/reference/profiles.md)
- [Report format](docs/reference/report.md)
- [Architecture](docs/explanation/architecture.md)
- [Decision records](docs/adr/README.md)
- [All docs](docs/README.md)

## Development

AI agents write most of this project and the maintainer reviews their work. The model is Claude Fable 5.2. [AGENTS.md](AGENTS.md) describes the process. To contribute, read [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[GPL-2.0-or-later](LICENSE). The tool is free and has no paid tier.

## Credits

Made by [alexposlushnyak](https://github.com/alexposlushnyak). Backed by [jkdevstudio](https://jkdevstudio.com), a studio that builds WordPress themes.
