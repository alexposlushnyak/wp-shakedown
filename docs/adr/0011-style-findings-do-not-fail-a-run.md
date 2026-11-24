# 0011. Style findings do not fail a run

- Status: Accepted
- Date: 2026-11-24

## Context and problem statement

PHP_CodeSniffer has two levels, error and warning, and each sniff picks one. WPCS reports a missing space after a parenthesis as an error, the same level as output that is not escaped. A theme of ordinary size gets hundreds of style errors. If the tool passed the levels through, every run would fail, and the security findings would sit in the middle of that list.

## Considered options

- Pass the PHPCS level through unchanged
- Leave style sniffs out
- Sort sniffs into categories and lower the severity of the style category

## Decision outcome

The `wpcs` engine gives every sniff a category. In the `standards` category a PHPCS error becomes a `warning` and a PHPCS warning becomes `info`. Every other category keeps its level.

The default `--fail-on error` then fails a run on security, compatibility and correctness findings, and on nothing else. Style findings stay in the report for whoever wants them, and `--fail-on warning` makes them count.

Leaving style sniffs out would hide what wordpress.org and marketplace reviewers also look at.

## Consequences

- The category table in the engine is ours to maintain. A sniff that is missing from it lands in `standards`, so a new security sniff in WPCS is under-rated until the table is updated.
- A project that wants style errors to fail the run sets `--fail-on warning`.
- The Markdown report counts style findings per rule and does not list them. On the WPCS source code, 82 files, that took the report from 596 KB to 5 KB.
- The mapping also applies when the project brings its own PHPCS ruleset.
