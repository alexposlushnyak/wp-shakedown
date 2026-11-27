# 0032. Run history is a folder per run inside the report folder

- Status: Accepted
- Date: 2026-11-27
- Refines: [ADR 0009](0009-reports-outside-the-target.md)

## Context and problem statement

Each run overwrote the reports of the run before it. The tool compared a run with the one before, and that was all. A maintainer who fixes a theme over a week wants to open the report of Monday, and to compare Friday with Monday, not only with Thursday.

## Considered options

- A SQLite database in the home folder
- One JSON file that holds every run
- A folder per run, next to the latest reports

## Decision outcome

Every run also writes its `report.json` to `runs/<run>/` in the report folder. The run ID is the finish time, `2026-11-27T10-41-03-123Z`, so the folders sort by time. The files at the top of the report folder stay a copy of the latest run in every format, so paths that scripts, the MCP server and the web page read do not change.

Only the JSON is kept per run. The other formats come from it, so the page and `wp-shakedown history` write the report of an old run, compared with any other run, when someone asks for it.

The folder keeps the 20 newest runs and deletes older ones after each run. A report folder from an older version has a `report.json` and no `runs/`. The first run of the new version saves that report as the first entry of the history.

A database needs a native module or a WebAssembly build for a few dozen records per project. One file with every run is rewritten in full after each run, and a crash in the middle loses all of it. Plain folders are the format of every other file the tool writes.

## Consequences

- `wp-shakedown history <project>` lists the runs, and `wp-shakedown history <project> <run>` prints the report of one run, compared with the run before it or with `--against <run>`.
- The page lists the runs of a project, opens the report of any of them and compares two of them.
- The API reads a run only by an ID that matches the pattern of run IDs, so a request cannot reach a path outside `runs/`.
- A big theme with thousands of style findings has a `report.json` of a few megabytes, so the history of one project can take up to a hundred megabytes. The limit of 20 is fixed for now.
