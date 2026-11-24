# 0008. Finding IDs leave out the line number

- Status: Accepted
- Date: 2026-11-24

## Context and problem statement

A finding needs an ID that survives between runs. The comparison with the last run depends on it, and so does the baseline file. Code moves while someone fixes it: adding three lines at the top of a file shifts every finding below.

## Considered options

- Hash the engine, rule, file, line and message
- Hash the engine, rule, file and message, without the line
- Hash the source text around the finding

## Decision outcome

The ID is a hash of the engine, the rule, the unit, the file or URL, the selector and the message. The line is not part of it.

With the line in the hash, one edit near the top of a file would mark every finding below as fixed and report each again as new. The baseline would stop matching for the same reason. Hashing the surrounding source text handles moves better, but the tool would have to read and normalise source for every engine, and findings on a URL have no source text.

## Consequences

- When a file has the same finding twice, the copies get different IDs in line order. Deleting the first copy shifts the ID of the second.
- Renaming a file changes the IDs of its findings.
- An engine that puts a line number or a variable value into its message produces unstable IDs. The adapter for that engine must strip such parts from the message.
