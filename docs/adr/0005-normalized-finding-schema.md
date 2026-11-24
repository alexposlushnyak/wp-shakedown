# 0005. One finding schema, SARIF as an export

- Status: Accepted
- Date: 2026-11-24

## Context and problem statement

The engines do not share an output format. PHP tools emit their own JSON or checkstyle XML, test runners emit JUnit or CTRF, browser tools emit their own JSON. SARIF is native only in a few tools. The report has to be one thing that a person or an AI assistant can act on.

## Considered options

- Pass each tool's output through unchanged
- Use SARIF as the internal format
- Define our own finding schema and export to SARIF

## Decision outcome

Our own finding schema inside, with exports to Markdown, JSON, SARIF and HTML.

Raw output would leave the merging to the reader. SARIF is built for static analysis: it has no natural place for a finding on a URL, a failed health check or a vulnerable version. An internal schema can hold all three, and SARIF stays available for tools that read it.

## Consequences

- Each adapter converts its tool's output to findings.
- A finding has a stable ID, so runs can be compared and findings silenced with a reason.
- A finding carries the command that re-runs just that check.
- The schema is documented under `docs/reference/` once it exists in code.
