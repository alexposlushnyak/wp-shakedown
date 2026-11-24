# 0009. Reports are written outside the target

- Status: Accepted
- Date: 2026-11-24

## Context and problem statement

The report has to land somewhere. The usual way to run the tool is from inside the folder under test, as `wp-shakedown run .`. A report folder created there would sit in the theme or plugin, show up in the next scan, and in a WordPress folder it would add files to a site.

## Considered options

- A folder in the current directory
- A folder in the target
- A folder per target under the user's home directory

## Decision outcome

Without `--out`, the report goes to `~/.wp-shakedown/reports/<name>-<hash>/`, where the hash comes from the target path. The tool refuses any report folder inside the target, including one given with `--out`.

The rule that the tool does not write into what it tests then holds for every run. The location is the same on each run of the same target, so the tool finds the previous report there and compares the two without an extra flag.

## Consequences

- The command prints the report path, because the user does not choose it.
- Moving or renaming the target starts a new report folder, and the comparison with the last run starts over.
- Old report folders stay in the home directory until the user deletes them.
