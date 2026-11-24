# 0020. Checks the user writes live in the home folder

- Status: Accepted
- Date: 2026-11-24

## Context and problem statement

The user wants to add checks of their own: a pattern that must not appear, a file that must exist, a command such as a test suite. A check must not be able to break the rest of the run, and the user decides what happens when a check itself cannot run.

A check of the `command` type runs a shell command. The tool also tests folders the user did not write, such as a downloaded theme, and an AI assistant can start a run through MCP.

## Considered options

- A config file inside the folder under test
- Check files in `~/.wp-shakedown/checks/`, with a scope in each file
- Both, with a list of trusted folders

## Decision outcome

A check is one JSON file in `~/.wp-shakedown/checks/`. The tool never reads a check from the folder it tests.

A config file in the target would let that folder choose commands for the tool to run. A run on a downloaded theme would then execute what the theme asks for. The home folder belongs to the user, so its commands are the user's own. A list of trusted folders solves the same problem with more to configure and to get wrong.

Each file becomes its own engine with the ID `custom:<name>`. The runner already isolates engines: one that throws is marked failed and the others run. `onError` in the file picks between failed, skipped and a warning. The fields `kinds`, `paths` and `depth` set where and when a check runs.

## Consequences

- Checks do not travel with a project. A team shares them by sharing files.
- A check for one project names that project in `paths`.
- The three types cover text, files and commands. Anything else is a command.
- The file format is validated with a JSON schema that rejects unknown fields, so a typo shows as an invalid file.
- A `command` check runs with the user's rights and without a sandbox. A timeout stops one that hangs.
