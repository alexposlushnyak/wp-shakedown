# 0028. Presets are a list of engines, a level and a threshold, and user presets are files

- Status: Accepted
- Date: 2026-11-26
- Supersedes: [0018](0018-a-profile-is-a-list-of-engines.md)

## Context and problem statement

A profile named a list of engines for one gate and changed nothing else. Three things came up. A gate wants its own level, because the rules it checks sit at a known place on the [scale of levels](0027-levels-0-to-10.md). A team wants a gate of its own, such as the checks it runs before a handover to a client, without a change to the tool. A theme or plugin that goes to a client or is sold outside the directories fits none of the four profiles.

## Considered options

- Keep profiles as code and add a level
- Let a config file in the project define presets
- Built-in presets in code, and user presets as JSON files in the home folder

## Decision outcome

A preset is a list of engine IDs for one or two kinds of target, with an optional level and an optional exit threshold (`failOn`). The word replaces "profile". `--profile`, the `profile` argument of the MCP server and of the local server, and the `profile` field of old reports stay as aliases.

The built-in presets are code in `src/presets.ts`: `wporg-theme`, `envato` and `wporg-plugin` at level 7, `client` at level 8 and `site` at level 6. The new `client` preset is for a theme or a plugin made for a client or sold outside the directories. It runs the WordPress standards, the PHP versions, `phpstan` and the JavaScript and CSS linters, and none of the rules that only the directories have.

A user preset is one JSON file in `<home>/presets/<id>.json`. The tool never reads a preset from the folder it tests, for the same reason as in [ADR 0020](0020-user-checks-live-in-the-home-folder.md): a downloaded theme must not choose what runs on it. The ID is the file name and cannot be the ID of a built-in preset. The file is validated with a JSON Schema, and a file that does not pass is listed as a problem and skipped. It stops only a run that asks for that preset. The web page writes and removes these files through the local server.

A preset still changes nothing about how an engine works. A finding has the same ID and severity under every preset.

A preset may name an engine that does not exist, for example one that a later version adds. The tool drops such IDs without an error, so a preset file keeps working across versions and a built-in preset can list an engine before it ships.

The level of a preset applies unless the run sets one. The exit threshold of a preset applies unless `--fail-on` is given. A preset keeps the level filter, so an engine above the level stays out even when the preset lists it.

## Consequences

- `src/profiles.ts` is deleted. `profiles` stays as a deprecated export of the built-in list.
- `EngineContext.profile` and `Engine.variant(profile)` become `preset`. The `theme-check` engine still picks the Envato fork for the preset `envato`.
- A run with a preset is a partial run, like a run with `--engine`: it does not report stale baseline entries.
- A preset and a list of engines do not combine. The tool stops and says so.
- The run result records the preset ID and the level. A change of preset does not report findings as fixed, because the comparison counts only engines that ran both times.
- Presets are not shared with a project. A team shares them by sharing files.
