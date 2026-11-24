# Your first run

This tutorial takes you from nothing installed to a report on a theme.

## 1. Check what you have

You need Node.js 22.18 or newer. For the PHP checks you also need PHP and Composer.

```bash
node --version
php --version
composer --version
```

Without PHP or Composer the tool still runs. It skips the checks that need them and says so.

## 2. Run it on a theme

Point it at a theme folder. A plugin folder or a whole WordPress folder works the same way.

```bash
npx wp-shakedown run /path/to/your-theme
```

`npx` downloads the tool the first time. Nothing is added to your project.

The first run installs the tools the engines use: PHP_CodeSniffer, the WordPress standards, Theme Check, ESLint and Stylelint. That takes under a minute and happens once.

You then see one line per engine, and a summary:

```
  php-lint: Checking syntax with PHP 8.4.25.
ok php-lint: 1 finding, 0.2s
ok theme-check: 2 findings, 0.1s
ok wpcs: 2 findings, 0.2s
  php-compat: Checking against PHP 7.4 and newer.
ok php-compat: 0 findings, 0.2s
ok wp-json: 0 findings, 0.1s
ok eslint: 2 findings, 1.6s
ok stylelint: 3 findings, 0.6s
2 errors, 4 warnings, 4 notes.
Report: /Users/you/.wp-shakedown/reports/your-theme-1a2b3c4d/report.md
```

The command exits with 1, because the run found errors.

## 3. Read the report

Open `report.md`. Findings are grouped by file:

```
### functions.php

- error `1eca0f685152` line 9: All output should be run through an escaping function ... (wpcs: WordPress.Security.EscapeOutput.OutputNotEscaped)

### inc/broken.php

- error `83cf061b365f` line 2: syntax error, unexpected token "{", expecting variable (php-lint: syntax)
```

Each finding has an ID in backticks. The ID stays the same on the next run, even when the line number changes.

Code style findings are counted per rule at the end. `report.html` in the same folder has the full list.

## 4. Fix and run again

Fix one of the errors and run the same command again. The output now has a line that compares the two runs:

```
1 fixed, 0 new, 2 still open.
```

To hand the work to an AI assistant, give it the path of `report.md` and ask it to fix the findings.

## 5. Try the web page

```bash
npx wp-shakedown ui /path/to/your-theme
```

A page opens in your browser. Choose Run the checks to see the same engines work, then filter and search the findings. [Local web page](../reference/ui.md) describes it.

## Next

- [Command line](../reference/cli.md) for the options, the exit codes and the baseline file
- [Engines](../reference/engines.md) for what each check looks for
