# 0026. Projects come from the folder dialog of the system and from ZIP files

- Status: Accepted
- Date: 2026-11-26

## Context and problem statement

The web page added a project through a folder list that the page drew itself ([ADR 0014](0014-local-web-page.md)). People expect the folder dialog of their system, and many get a theme or plugin as a ZIP file, not as a folder. A browser does not give a page the absolute path of a folder it picks, and the tool needs that path. A ZIP file has to become a folder before any engine can read it.

## Considered options

For the folder:

- The folder list drawn by the page, as before
- `showDirectoryPicker()` in the browser
- The server opens the dialog of the system: `osascript` on macOS, PowerShell with `FolderBrowserDialog` on Windows, `zenity` or `kdialog` on Linux

For the ZIP file:

- The `unzip` or `tar` command of the system
- An npm package
- A reader of our own on `node:zlib`

## Decision outcome

The server opens the dialog of the system, and the page shows it as the main way to add a project. The folder list and the path field stay as a second way, and they are the only way when the system has no dialog the tool can open, for example a Linux machine with neither zenity nor kdialog, or a container.

`showDirectoryPicker()` returns a handle without a path, so the tool could not run anything on that folder.

The tool unpacks ZIP files with a reader of its own on `node:zlib`. It reads stored and deflated entries, the two methods zip tools use for themes and plugins. `unzip` is missing on many Linux images and on Windows, and `tar` on Linux does not read ZIP. A package would be the second runtime dependency for about a hundred lines of code. Our own reader also enforces the limits in one place: no path that leaves the folder, no symbolic links, no encrypted or ZIP64 archives, at most 20,000 files and 1 GB unpacked, and every entry checked against its size and CRC.

An archive becomes `~/.wp-shakedown/uploads/<themes|plugins|sites>/<folder>`, named after the one folder it holds, or after the archive when it holds loose files. A newer archive of the same theme replaces the folder, so its project, its report folder and the comparison with the last run stay the same.

## Consequences

- `src/ui/picker.ts` builds the command for each system and reads its answer. `POST /api/pick` opens one dialog at a time and answers 501 when the system has none.
- `src/zip.ts` unpacks, `src/uploads.ts` turns an archive into a project folder. `POST /api/upload` takes the archive as the request body, up to 256 MB. `wp-shakedown add` and `run` accept a ZIP path through the same code.
- Removing an uploaded project deletes its unpacked folder. Its reports stay, as for any project.
- The dialog on Windows and Linux is covered by tests of the command the tool builds, not by a dialog opened in CI.
