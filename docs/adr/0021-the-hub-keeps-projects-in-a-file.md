# 0021. The hub keeps its projects in a file

- Status: Accepted
- Date: 2026-11-24

## Context and problem statement

The user works on several themes, plugins and sites. They want one place that lists them, runs their checks side by side and shows the last result of each. That place has to remember the projects and their results between sessions, on the user's machine, without a database to set up.

## Considered options

- An embedded database such as SQLite
- A JSON file with the list of projects, and the report folders as the store of results
- No list: the user names paths every time

## Decision outcome

`~/.wp-shakedown/projects.json` holds the paths of the projects and when each was added. Nothing else is stored about a project.

Everything the hub shows is read at the moment it is shown. The name and the kind come from the folder. The last result comes from `report.json` in the report folder of that project, which every run writes already ([ADR 0009](0009-reports-outside-the-target.md)).

A database would be a second copy of what the report files hold, with a schema to migrate and a native module to build on install. The list is a few dozen lines at most, and the tool rewrites the file through a rename, so a reader never sees half of it.

## Consequences

- The list cannot go stale against the reports, because the reports are the data.
- A project whose folder was moved or deleted stays on the list and says what is wrong. The user removes it.
- A project is identified by the first eight characters of the hash of its path. A moved folder is a new project.
- Runs of different projects go in parallel inside one process. Engines of one run still go one after another.
- Removing a project keeps its reports.
- The command line and the web page read and write the same file.
