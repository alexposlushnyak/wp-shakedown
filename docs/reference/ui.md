# Local web page

```
wp-shakedown ui [path] [options]
```

The command starts a server on your machine and opens a page in your browser. On the page you pick a folder, start a run, watch each engine work and read the findings.

`[path]` is the folder the page starts in. Without it the page starts in the current folder.

| Option | What it does |
|---|---|
| `--port <n>` | Uses this port. The default is a free port |
| `--no-open` | Does not open the browser. The command prints the link |

Press Ctrl+C in the terminal to stop the server.

## What is on the page

**The target.** Type a path or choose Browse to walk through your folders. The page says what it found: a theme, a plugin, or a WordPress folder with a number of themes and plugins. Under Engines you can turn engines off for this run. When a [profile](profiles.md) fits what the page found, a Profile list shows. Choose one to run only its engines.

**The run.** Each engine gets a line with its state, the number of findings and the time it took. In a WordPress folder every theme and plugin gets its own lines. Notes from an engine, such as a first-time install of its tools, show under its line. Stop ends the run.

**The results.** The page shows the counts, the comparison with the last run and the path of the report file. You can filter findings by severity, engine and category, and search the message, the rule and the file name. Code style findings are counted per rule. Tick "List code style findings" to see each one.

Two buttons copy text for you: the path of `report.md`, and a short prompt that tells an AI assistant to read that report and fix the findings.

The page writes the same four report files as [`wp-shakedown run`](cli.md).

## Access

The server listens on `127.0.0.1` only, so other machines on your network cannot reach it.

The link the command prints carries a token. The server answers a request only when it has that token, comes from the page itself and names the local address. Another site open in your browser cannot use the server to list your folders or start a run.

One run happens at a time.
