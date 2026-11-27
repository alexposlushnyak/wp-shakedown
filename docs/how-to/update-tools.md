# How to update the tools

wp-shakedown runs other tools: PHPCS, PHPStan, Theme Check, ESLint, Stylelint and PHP itself. Their versions are pinned in lock files, so a run gives the same result today and next month.

## For maintainers

Two things keep the pins current.

Dependabot opens one grouped pull request per month for each manifest it understands: `php-tools` (Composer), `js-tools`, `php-wasm`, `ui` and the root (npm), and the GitHub Actions.

Four pins are by hand, because they are not normal Composer or npm dependencies. Dependabot cannot see them.

| Pin | Where | Latest version comes from |
|---|---|---|
| Theme Check | `php-tools/composer.json`, a zip from wordpress.org | the wordpress.org plugin API |
| Envato Theme Check | `php-tools/composer.json`, a commit of `envato/envato-theme-check` | the head of the pinned branch |
| Plugin Check sniffs | `php-tools/composer.json`, a tag zip of `WordPress/plugin-check` | the latest GitHub release |
| `@php-wasm/node` | `php-wasm/package.json` | the npm registry |

`scripts/tools-check.mjs` compares these four with upstream and prints a table. The Tools workflow runs it every Monday, writes the new pins, refreshes the lock files and opens one pull request on the branch `chore/tools-update`. The normal CI runs on that pull request. Merge it when CI passes.

### Run it by hand

```bash
npm run tools:check
```

The exit code is 0 when every pin is current, 1 when one is behind and 2 when a lookup failed. Set `GITHUB_TOKEN` to avoid the GitHub rate limit for anonymous requests.

To update the pins:

```bash
npm run tools:check -- --write
```

This edits `php-tools/composer.json` and `php-wasm/package.json`, and prints the commands that refresh the locks. It does not run them. They look like this:

```bash
composer update --working-dir php-tools theme-check/theme-check
npm install --prefix php-wasm
```

Run them, then `npm test`. To start the workflow yourself, use the Run workflow button on the Tools workflow page.

## For users

The tools live in `~/.wp-shakedown/tools`, in one folder per tool set and lock file: `php-<hash>`, `php-<hash>-wasm` and `js-<hash>`. The hash comes from the lock file that ships with wp-shakedown.

- A new wp-shakedown release with a new lock file has a new hash. The next run installs fresh tools into a new folder.
- A release with the same lock file reuses the folder, so nothing downloads.
- `npx wp-shakedown@latest` runs the newest release and with it the newest tools.
- Old folders stay on disk. Delete any folder in `~/.wp-shakedown/tools` you no longer use. wp-shakedown installs it again when a run needs it.
