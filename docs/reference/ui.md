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

The list has a group for themes, one for plugins and one for WordPress folders. A folder that is gone or is no longer a theme, a plugin or a WordPress folder goes to a last group, Cannot be tested.

Each project has one line: its name, its path, and the result of its last run. A dot shows the state at a glance: red for errors, amber for warnings, green for a clean run, grey for a project that never ran.

The dock at the bottom of the page stays on every screen. The mark takes you back to the list, the status says how many runs work and wait, and Add a folder adds a project.

## Adding a project

Add a folder opens the folder dialog of your system: Finder on macOS, the folder browser on Windows, zenity or kdialog on Linux. The server opens it, because a browser does not tell a page the full path of a folder. Pick the folder of a theme, a plugin or a WordPress site and the page adds it and opens it.

The ⋯ button next to it has two more ways:

- Upload ZIP files takes one archive or several. Each one becomes a project, and their runs start in the queue at once.
- Browse or type a path opens a dialog where you paste a path or walk through your folders. The page says what it found before you add it. Without a folder dialog on the system, for example on Linux with neither zenity nor kdialog, Add a folder opens this dialog.

You can also drop ZIP files anywhere on the page.

The server unpacks an archive into `~/.wp-shakedown/uploads/themes/<folder>`, `plugins/<folder>` or `sites/<folder>`, named after the one folder the archive holds, or after the archive when it holds loose files. A newer archive of the same theme replaces the old files, so the page compares the new run with the old one. It refuses an archive while that project runs, an archive over 256 MB, one that unpacks to more than 1 GB or 20,000 files, encrypted and ZIP64 archives, and any path that would leave the folder. It skips symbolic links.

Choose Quick, Standard or Deep to set the [depth](cli.md#depth) of the next runs. Run all starts every project. The button on a line starts or stops that one project.

Up to three projects run at the same time. The others wait their turn. A line that runs shows how far it is and which engine works now.

The list is the file `~/.wp-shakedown/projects.json`, the same one [`wp-shakedown list`](cli.md#projects) reads.

## One project

Select a line to open the project. There you choose a [profile](profiles.md) and the depth, and start or stop the run. For a theme, a switch turns on the [experimental checks](engines.md#theme-review) from theme reviews. While it runs, every engine has a line with its state. In a WordPress folder the lines come in one group per theme and plugin, each with how many of its engines are done.

After the run the page shows three numbers: errors, warnings and notes. Under them it says when the run happened, how it compares with the run before, and whether an engine failed.

The page does not list the findings. Open the report shows the full HTML report in a new tab. Two buttons copy text for you: the path of `report.md`, and a short prompt that tells an AI assistant to read that report and fix the findings.

Remove from the list takes the project off the list and deletes the unpacked folder of a ZIP upload. Its reports stay.

The page writes the same four report files as [`wp-shakedown run`](cli.md).

## Access

The server listens on `127.0.0.1` only, so other machines on your network cannot reach it.

The link the command prints carries a token. The server answers a request only when it has that token, comes from the page itself and names the local address. Another site open in your browser cannot use the server to list your folders or start a run.

Up to three runs happen at a time.
