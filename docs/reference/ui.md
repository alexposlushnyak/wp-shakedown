# Local web page

```
wp-shakedown ui [path] [options]
```

The command starts a server on your machine and opens a page in your browser. The page is the hub: it lists your projects, runs their checks side by side and shows each run while it happens.

`[path]` is a folder to put on the list. Without it the page opens with the list as it is.

| Option | What it does |
|---|---|
| `--port <n>` | Uses this port. The default is a free port |
| `--no-open` | Does not open the browser. The command prints the link |

Press Ctrl+C in the terminal to stop the server.

## The list of projects

Each project has one line: its name, what it is, and the result of its last run. A dot shows the state at a glance: red for errors, amber for warnings, green for a clean run, grey for a project that never ran.

Add opens a dialog where you type a path or walk through your folders. The page says what it found before you add it.

Choose Quick, Standard or Deep to set the [depth](cli.md#depth) of the next runs. Run all starts every project. The button on a line starts or stops that one project.

Up to three projects run at the same time. The others wait their turn. A line that runs shows how far it is and which engine works now.

The list is the file `~/.wp-shakedown/projects.json`, the same one [`wp-shakedown list`](cli.md#projects) reads.

## One project

Select a line to open the project. There you choose a [profile](profiles.md) and the depth, and start or stop the run. While it runs, every engine has a line with its state.

After the run the page shows three numbers: errors, warnings and notes. Under them it says when the run happened, how it compares with the run before, and whether an engine failed.

The page does not list the findings. Open the report shows the full HTML report in a new tab. Two buttons copy text for you: the path of `report.md`, and a short prompt that tells an AI assistant to read that report and fix the findings.

Remove from the list takes the project off the list. Its reports stay.

The page writes the same four report files as [`wp-shakedown run`](cli.md).

## Access

The server listens on `127.0.0.1` only, so other machines on your network cannot reach it.

The link the command prints carries a token. The server answers a request only when it has that token, comes from the page itself and names the local address. Another site open in your browser cannot use the server to list your folders or start a run.

Up to three runs happen at a time.
