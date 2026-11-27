# MCP server

```
wp-shakedown mcp
```

The command starts a [Model Context Protocol](https://modelcontextprotocol.io/) server on standard input and output. An AI assistant that speaks MCP can then run the checks itself, read the findings, fix the code and run the checks again.

You do not start the command by hand. You name it in the assistant's settings and the assistant starts it.

## Connect an assistant

Claude Code:

```bash
claude mcp add wp-shakedown -- npx -y wp-shakedown mcp
```

Any client that reads a JSON config, such as Cursor or Claude Desktop:

```json
{
  "mcpServers": {
    "wp-shakedown": {
      "command": "npx",
      "args": ["-y", "wp-shakedown", "mcp"]
    }
  }
}
```

To use Wordfence Intelligence, add the key to the `env` of that entry as `WP_SHAKEDOWN_WORDFENCE_KEY`. [Engines](engines.md) lists the other variables.

## Tools

| Tool | What it does | Changes anything |
|---|---|---|
| `detect_target` | Says what a folder is: a theme, a plugin or a WordPress site, and which themes and plugins a site holds | No |
| `list_engines` | Lists the engines with their IDs and levels, your own checks included | No |
| `run_checks` | Runs the engines on a folder and returns the report as Markdown | Writes report files. Never changes the target |
| `list_findings` | Returns findings of the last run on a folder, filtered and paged, as JSON | No |
| `list_presets` | Lists the built-in presets and your own, with their engines, level and settings, as JSON | No |
| `list_runs` | Lists the kept runs of a folder, newest first, with a number, the time and the counts, as JSON | No |
| `get_run` | Returns the short report of one run, compared with the run before it, as Markdown. `run` is a number from `list_runs` or a run ID, `against` picks another run to compare with, `full` returns the full report | No |
| `get_assistant_checks` | Returns the [checks for an assistant](assistant.md) of the last run, or of `run`, each with a full prompt, as Markdown. The assistant then answers them itself | No |

### run_checks

| Argument | Type | Meaning |
|---|---|---|
| `path` | string, required | Absolute path of the folder to test |
| `engines` | array of strings | Engine IDs to run. Without it, every engine that fits the target runs |
| `preset` | The ID of a [preset](presets.md) | Runs only the engines of one preset, at its level. The list of IDs is read when the client asks for the tools, so it includes your own presets. It does not combine with `engines`. `profile` is the old name |
| `level` | integer, 0 to 10 | How thorough the run is. The default is 6. A preset can set its own. See [Levels](cli.md#levels). `depth` (`quick`, `standard` or `deep`) is the old name |
| `experimental` | boolean | An old name. It raises the level to at least 7 and, without a preset, turns on the review rules of wordpress.org, as `theme-review` used to run |
| `type` | `theme`, `plugin` or `install` | Use it only when detection is wrong |

The answer is the same Markdown report that [`wp-shakedown run`](cli.md) writes, followed by the path of the report file. Code style findings are counted per rule. When a second run follows a first, the report says what is fixed, what is new and what is still open.

A report longer than 60,000 characters is cut, and the answer says where the full file is.

While it runs, the tool sends progress to a client that asked for it: one message per engine. A client can cancel the call, and the run stops. One run happens at a time.

### list_findings

| Argument | Type | Meaning |
|---|---|---|
| `path` | string, required | Absolute path of the folder that was tested |
| `severity` | `error`, `warning` or `info` | `error` is Critical, `warning` is Important and `info` is Recommended |
| `engine` | string | An engine ID |
| `category` | string | Such as `security` or `compatibility` |
| `file` | string | Part of a file path |
| `id` | string | One finding ID |
| `include_style` | boolean | Also list code style findings |
| `limit` | 1 to 200 | The default is 50 |
| `offset` | integer | Where the page starts |

The tool reads the report of the last run. It does not run anything. Call `run_checks` first.

## What to tell the assistant

Something like this is enough:

> Run wp-shakedown on this theme, fix the errors, and run it again until none are left.

The server tells the assistant the same in its own instructions: run the checks, fix the errors first, run again to confirm.
