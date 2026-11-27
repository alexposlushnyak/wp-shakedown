# 0035. Review cases from trac are files with a fixture, and a test runs each one

- Status: Accepted
- Date: 2026-11-27

## Context and problem statement

The rules of wp-shakedown came from a study of 1500 theme tickets in themes.trac. The study lives outside the repository, so nothing tells a contributor which reviewer requests the tool catches, which it leaves to an assistant, and which it does not cover. A change to a rule can also stop catching a case without any test noticing, because the unit tests check the rule on the input its author had in mind.

## Considered options

- A table in the docs
- One file per case with a link to the ticket, and a test that runs a small fixture for each case
- Import the tickets automatically from trac

## Decision outcome

`cases/<id>/case.json` describes one request reviewers make: a summary in our words, the ticket links, a category, tags, and a status. `caught` names the engine and rule that must report it, `assistant` names the [assistant check](../reference/assistant.md) that must be listed for it, and `open` says why the tool does not cover it yet. A `caught` or `assistant` case has a theme or plugin in `cases/<id>/fixture/` that shows the problem. `checked` is the date someone last confirmed the case against the tool.

`test/cases.test.ts` validates every file, runs each fixture and fails when a `caught` case is not reported or an `assistant` case is not listed. It also fails on two cases with the same ticket and the same rule.

The study cannot be imported again: trac blocks automated requests, and the study read it through the browser of the maintainer. Each case keeps the ticket link, so anyone can read the request in its own words.

## Consequences

- A new rule starts as a case with a fixture, and the case proves the rule catches it.
- An `open` case is a list of what the tool cannot see, with a reason. Most need a running WordPress or a browser.
- The cases are not part of the npm package.
