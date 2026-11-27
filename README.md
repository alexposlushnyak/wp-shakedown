<h1>
  <img alt="wp-shakedown" src=".github/assets/wordmark-on-light.png#gh-light-mode-only" width="360">
  <img alt="wp-shakedown" src=".github/assets/wordmark-on-dark.png#gh-dark-mode-only" width="360">
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
- It writes one report that an AI assistant can read and fix from, and lists the checks that need someone to read the code, for an assistant to answer.
- It keeps the last runs of each project, so you can compare any two.

## What it checks

| Target | Checks |
|---|---|
| Theme or plugin folder | Coding standards, static analysis at the deep level, PHP compatibility, `theme.json` and `block.json`, JavaScript and CSS, and the review rules of wp-shakedown. For a theme, the Theme Check rules of wordpress.org |
| WordPress folder | File integrity, known vulnerabilities, outdated or abandoned software, risky settings and files, suspicious files such as web shells, and the tests of Site Health when WP-CLI can reach the database. To test a theme or plugin inside it, give its own folder |

A preset picks the engines for one purpose: `--preset wporg-theme`, `envato`, `wporg-plugin`, `client` or `site`. The requirements of wordpress.org and ThemeForest are one scenario, which a preset switches on. `--level` from 0 to 10 sets how thorough the run is: 0 only checks that the PHP parses, 6 is the default, and `quick`, `standard` and `deep` work as 3, 6 and 8. You can add [checks of your own](docs/reference/checks.md).

## How you run it

| From | Command |
|---|---|
| The terminal | `npx wp-shakedown run <folder>` |
| A page in your browser | `npx wp-shakedown ui` |
| An AI assistant, over MCP | `npx wp-shakedown mcp`, set up once in the assistant |
| GitHub Actions | `uses: alexposlushnyak/wp-shakedown@main`. GitLab CI and Bitbucket run it with npx |
| Docker | `docker run --rm -v "$PWD:/work/theme:ro" ghcr.io/alexposlushnyak/wp-shakedown run /work/theme` |

All of them use the same core. A `wp-shakedown.json` in the project sets the preset, the level and what fails the build for every one of them.

## What you need

- Node.js 22.18 or newer.
- PHP and Composer for the PHP checks. Without them those checks are skipped and the rest still runs, or set `WP_SHAKEDOWN_PHP=bundled` to run them on a PHP that wp-shakedown downloads.

You do not install PHPCS, PHPStan, ESLint or Stylelint. The first run fetches pinned versions into `~/.wp-shakedown`.

The tests run on macOS, Linux and Windows. The Docker image has PHP, Composer, Node and every tool installed.

## Documentation

- [Your first run](docs/tutorials/first-run.md)
- [Command line](docs/reference/cli.md)
- [Local web page](docs/reference/ui.md)
- [MCP server](docs/reference/mcp.md)
- [Engines](docs/reference/engines.md)
- [Presets](docs/reference/presets.md)
- [Settings file](docs/reference/config.md)
- [Checks for an assistant](docs/reference/assistant.md)
- [Report format](docs/reference/report.md)
- [Run in CI](docs/how-to/ci.md) and [in Docker](docs/how-to/docker.md)
- [Architecture](docs/explanation/architecture.md)
- [Decision records](docs/adr/README.md)
- [All docs](docs/README.md)

## Development

AI agents write most of this project and the maintainer reviews their work. The models are Claude Opus 5.5 and Claude Sonnet 5.5; the project started with Claude Fable 5.2. [AGENTS.md](AGENTS.md) describes the process. To contribute, read [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[GPL-2.0-or-later](LICENSE). The tool is free and has no paid tier.

## Credits

Made by [alexposlushnyak](https://github.com/alexposlushnyak). Backed by [jkdevstudio](https://jkdevstudio.com), a studio that builds WordPress themes.
