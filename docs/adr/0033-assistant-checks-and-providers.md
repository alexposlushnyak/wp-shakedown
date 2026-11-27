# 0033. Checks no tool can make go to an AI assistant, through a tool the user already has

- Status: Accepted
- Date: 2026-11-27

## Context and problem statement

Many points that reviewers raise need someone to read the code and judge it: whether an escaping function fits the place the value lands, whether a request handler checks the nonce and the capability, whether a theme keeps plugin features out, whether a menu works with the keyboard. No maintained tool answers these from the files, and wp-shakedown only orchestrates tools and adds rules where a pattern is enough. An AI assistant can answer them, but it reads the code of the user, and that code may belong to a client or to the buyers of a theme.

## Considered options

- Leave these points out of the tool
- Call a model API from the tool for every run
- List the checks in the report with a prompt each, and answer them on request through Claude Code, Codex or an API key, when the preset allows it

## Decision outcome

A list in `src/assistant/checks.ts` holds the checks. Each has the kinds it fits, the lowest level, the directories that require it, and the files that make it worth asking. A run lists the checks that apply, with the files to start from, in `report.json` and in a section of `report.md` and `report.html`. An assistant connected through MCP fetches them with `get_assistant_checks` and answers them itself.

`wp-shakedown assist` and the page answer them through a provider the preset names in its `assistant` field: `claude` runs `claude -p` with only the Read, Grep and Glob tools, `codex` runs `codex exec` in its read-only sandbox, and `api` calls the Anthropic API with a key. The CLIs use the subscription the user already pays for. Without the field nothing leaves the machine, and no built-in preset sets it.

The answers go to `assistant.json` and `assistant.md` next to the report, not into the findings. A model does not give the same answer twice, so its findings would break the stable IDs and the comparison of runs.

The key for the API comes from `ANTHROPIC_API_KEY` or from `~/.wp-shakedown/keys/anthropic`, a file only the user can read. The tool refuses a key file others can read.

## Consequences

- The text of the theme or plugin reaches the provider. The prompt tells the model to treat the files as data, and the CLIs get only reading tools, so text planted in a theme cannot run a command or change a file.
- When this was written, Claude Code was tested end to end. The API was tested up to the key check, without a working key, and Codex only with a stand-in program.
- The system keychain is not used yet. The key file is the shortcut until someone asks for it.
- The `api` provider needs `@anthropic-ai/sdk`, about 27 MB. It is not a dependency of the package: npm installs the version pinned in `ai-tools/` into the tools folder the first time someone uses the provider, as it does for the bundled PHP.
- Claude Code runs with `--setting-sources user`, so a `.claude` folder inside a theme cannot add hooks that run commands.
