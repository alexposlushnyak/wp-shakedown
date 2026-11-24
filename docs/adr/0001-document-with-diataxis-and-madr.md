# 0001. Document with Diátaxis and MADR

- Status: Accepted
- Date: 2026-11-24

## Context and problem statement

The project is developed with AI agents and in public. Agents start every session without memory, and readers judge the project by how its docs are organised. The docs need a structure that is recognised, not invented here.

## Considered options

- A custom folder layout
- Diátaxis for documents, MADR for decisions
- A single long README

## Decision outcome

Diátaxis for `docs/`, MADR for `docs/adr/`, and `AGENTS.md` as the entry file for agents.

Both formats are widely used, so a new contributor or agent already knows where to look. A custom layout would have to be explained first. A single README would break the rule that the README stays short.

## Consequences

- Each document has one job: tutorial, how-to, reference or explanation.
- Every architecture decision gets a record with its reason.
- Sections that describe a working tool stay empty until there is one.
