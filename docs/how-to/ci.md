# Run wp-shakedown in CI

Put the settings of the project in [`wp-shakedown.json`](../reference/config.md) at the root of the theme or plugin, so every CI system and every laptop runs the same checks:

```json
{
  "preset": "wporg-theme",
  "failOn": "important"
}
```

The job then fails when a run finds an important or critical finding. Exit code 2 means the run itself failed, for example when an engine crashed.

## GitHub Actions

This repository is an action. It sets up Node and PHP, caches the tools between runs, uploads the findings to code scanning, keeps the report as an artifact and writes the short report to the summary of the job.

```yaml
name: wp-shakedown

on:
  push:
    branches: [main]
  pull_request:

jobs:
  shakedown:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v7
      - uses: alexposlushnyak/wp-shakedown@main
```

Use a release tag in place of `main` to keep the version fixed.

| Input | Default | Meaning |
|---|---|---|
| `path` | `.` | The folder to test, relative to the repository |
| `preset`, `level`, `fail-on` | empty | The same as `--preset`, `--level` and `--fail-on`. Empty leaves the choice to `wp-shakedown.json` |
| `php-version` | `8.3` | The PHP the engines run on |
| `sarif` | `true` | Uploads `report.sarif` to code scanning. The job needs `security-events: write`, and code scanning has to be available for the repository. Set `false` otherwise |
| `artifact` | `wp-shakedown-report` | The name of the artifact with the report. Empty skips it |

The outputs are `exit-code` and `report-dir`. The action runs the version of wp-shakedown that the tag names, from its own files, so it needs no npm package.

The action sets up Node 22 and the PHP of `php-version` for the rest of the job. Put it after the steps that need another Node or PHP, or in a job of its own.

## GitLab CI

```yaml
wp-shakedown:
  image: node:22
  variables:
    WP_SHAKEDOWN_PHP: bundled
  script:
    - npx --yes wp-shakedown run . --out /tmp/wp-shakedown-report || status=$?
    - cp -r /tmp/wp-shakedown-report wp-shakedown-report
    - exit ${status:-0}
  artifacts:
    when: always
    paths:
      - wp-shakedown-report/
```

`WP_SHAKEDOWN_PHP=bundled` runs PHP from WebAssembly, so the Node image is enough. The first run of a job downloads about 160 MB of tools. Use an image with PHP 8.3 and Composer and drop the variable to run faster.

The report goes to `/tmp` first, because wp-shakedown never writes into the folder it tests. The script copies it into the project afterwards, so GitLab can keep it as an artifact, and then exits with the code of the run.

## Bitbucket Pipelines

```yaml
image: node:22

pipelines:
  default:
    - step:
        name: wp-shakedown
        script:
          - export WP_SHAKEDOWN_PHP=bundled
          - npx --yes wp-shakedown run . --out /tmp/wp-shakedown-report || status=$?
          - cp -r /tmp/wp-shakedown-report wp-shakedown-report
          - exit ${status:-0}
        artifacts:
          - wp-shakedown-report/**
```

The steps work the same way as in GitLab CI. Add `@<version>` after `wp-shakedown` in both files to keep the version fixed.
