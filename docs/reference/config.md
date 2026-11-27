# Settings file

A theme, a plugin or a WordPress folder can hold `wp-shakedown.json` at its root. Every run on that folder reads it: the command line, the web page and the MCP server.

```json
{
  "preset": "wporg-theme",
  "level": 7,
  "failOn": "important"
}
```

| Field | Meaning |
|---|---|
| `preset` | The ID of a [preset](presets.md), built in or one of yours |
| `engines` | Engine IDs to run, in place of a preset. Not together with `preset` |
| `level` | An integer from 0 to 10. See [Levels](cli.md#levels) |
| `failOn` | `critical`, `important`, `recommended` or `never`: the severity from which the command exits with 1. `error`, `warning` and `info` work too |

Every field is optional. A file with any other field is not valid. It cannot hold checks or commands, and it cannot turn on an [assistant](assistant.md): those live in your home folder, so a downloaded theme cannot choose them. See [ADR 0034](../adr/0034-settings-file-in-the-target.md).

## Which setting wins

A flag on the command line wins over the file, and the file wins over the preset. When you pass `--preset` or `--engine`, the file's `preset` and `engines` are ignored, and its `level` and `failOn` still apply unless you pass `--level` or `--fail-on`.

`--no-config` ignores the file, and so does `use_config: false` in `run_checks` of the MCP server. A file the tool cannot read stops the run with exit code 2 and the reason.

The report says when a run read the file, and the command prints `Settings from <path>.`

The baseline file, `wp-shakedown-baseline.json`, sits next to it. See [Baseline file](cli.md#baseline-file).
