# 0034. A project may hold a settings file, never checks or commands

- Status: Accepted
- Date: 2026-11-27
- Refines: [ADR 0020](0020-user-checks-live-in-the-home-folder.md)

## Context and problem statement

In CI the tool runs on a fresh machine with no home folder of the user. A project wants to say how it is tested: the preset for its directory, the level, the severity that fails the build. Passing those as flags works, but each CI system then holds the same settings in its own syntax, and a developer who runs the tool on their machine has to repeat them. ADR 0020 keeps checks out of the target because a check can run a command, and a downloaded theme must not choose commands for the tool to run.

## Considered options

- Flags only, set in each CI file
- A settings file in the target with the same fields as a user check file
- A settings file in the target that only picks from what the tool and the user already have

## Decision outcome

The tool reads `wp-shakedown.json` from the root of a theme, a plugin or a WordPress folder. It holds four fields: `preset` or `engines`, `level` and `failOn`. All four pick from what exists: the built-in presets, the presets and checks in the home folder of the user, the engines of the tool. The file cannot define a check, a command or a preset, and it cannot set `assistant`, so a project cannot send its own code, or anything else, to an AI provider.

What the caller sets wins: a flag on the command line, an argument of the MCP server, a choice on the page. `--no-config` and `use_config: false` ignore the file. A file the tool cannot read stops the run, because a CI job that silently falls back to other settings passes for the wrong reason.

## Consequences

- A project carries its test settings, and the same file works in GitHub Actions, GitLab CI, Bitbucket and on a laptop.
- A downloaded theme can lower its own level or set `failOn` to `never`. That changes only what the run reports to whoever runs it, and the report names the file. Pass `--no-config` to test a theme on your own terms.
- The report says when a run read the file.
