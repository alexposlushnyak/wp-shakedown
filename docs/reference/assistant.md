# Checks for an assistant

Some checks need someone to read the code and judge it. No tool answers them from the files. A run lists the ones that apply to a theme or plugin, and an AI assistant answers them. See [ADR 0033](../adr/0033-assistant-checks-and-providers.md).

## The checks

| ID | Kinds | Level | Directory | What the assistant checks |
|---|---|---|---|---|
| `escaping-context` | theme, plugin | 7 | | Each escaping function fits where the value lands, and escaping happens late |
| `sanitize-callbacks` | theme, plugin | 7 | | Each setting and option has a sanitize callback that fits its control |
| `request-handlers` | theme, plugin | 7 | | AJAX, admin-post and REST handlers check the nonce and the capability |
| `database-queries` | theme, plugin | 7 | | `$wpdb` queries go through `prepare()`, and a core API does not do the same job |
| `outgoing-data` | theme, plugin | 7 | `wporg`, `envato` | Requests to other servers, remote assets, cookies and tracking without consent |
| `keyboard-and-focus` | theme | 7 | | Visible focus, menus and dialogs that work with the keyboard |
| `content-links` | theme | 7 | `wporg` | Links inside content stay underlined |
| `reading-settings` | theme | 7 | | The front page follows the Reading settings |
| `plugin-territory` | theme | 7 | `wporg`, `envato` | Features a user would lose on switching themes |
| `upsell-and-notices` | theme, plugin | 7 | `wporg` | Admin notices can be dismissed for good, and promotion stays in one place |
| `readme-resources` | theme, plugin | 7 | `wporg`, `envato` | The readme names every bundled image, font and library with its license and source |
| `uninstall` | plugin | 8 | | Uninstalling removes the options, tables, events and roles the plugin made |
| `working-features` | theme | 8 | | Forms, search and buttons do something |
| `envato-documentation` | theme | 7 | `envato` | The documentation covers installing and setting up the theme |

A check with a directory is listed when the preset sets that [directory](presets.md#directory-rules), or at level 10. A check that looks for a pattern is listed only when a file has it, for example `database-queries` only when the code uses `$wpdb`. The run names up to 20 files to start from.

`report.md` and `report.html` show the checks under "For an assistant", each with its prompt. `report.json` has them in `assistant`. A run with `--engine` lists none.

## Answering them

There are two ways.

An assistant connected through the [MCP server](mcp.md) calls `get_assistant_checks` and works through the prompts itself. Nothing else needs to be set up.

`wp-shakedown assist` and the button on the web page send each check to a provider and collect the answers:

```
wp-shakedown assist <project> [--check <id>]...
```

The provider comes from the `assistant` field of the preset the last run used. Without it the command stops, and no code leaves your machine. No built-in preset sets it: copy one and set the field.

| Value | Provider | What it uses |
|---|---|---|
| `claude` | Claude Code | `claude -p` in the target folder, with only the Read, Grep and Glob tools. It uses your Claude Code sign-in |
| `codex` | Codex | `codex exec` in its read-only sandbox. It uses your Codex sign-in |
| `api` | Anthropic API | Claude Opus 5.5 with the files the check names, up to 400,000 characters. It needs a key. The first use installs the Anthropic SDK, about 27 MB |

Every provider sends the files of the project to Anthropic or OpenAI. The prompt tells the model that the files are data, not instructions, and the two command line tools cannot run commands or change files.

`--check` answers only the checks you name. The command prints one line per check, then the counts and the path of `assistant.md`.

### Answers

The answers go next to the report, in `assistant.json` and `assistant.md`, and into the folder of the run in `runs/`. They are not findings: a model does not answer the same way twice, so its findings would change IDs from run to run.

Each answer has a verdict, `pass`, `fail` or `unsure`, and findings with a file, a line, a severity, a message and a fix. A check the provider could not answer is `unsure` with the reason.

### The API key

```
wp-shakedown key set anthropic
wp-shakedown key remove anthropic
```

`key set` reads the key from the terminal without showing it, or from standard input, and saves it to `~/.wp-shakedown/keys/anthropic` with access for you only. `ANTHROPIC_API_KEY` wins over the file. The tool refuses a key file other users can read.
