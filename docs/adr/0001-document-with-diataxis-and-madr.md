# 0001. Document with Diátaxis and MADR

- Status: Accepted
- Date: 2026-11-24

## Context and problem statement

AI agents write this project, in public. An agent starts each session without memory, and a reader judges the project by how its docs are organised. The docs need a structure people already know.

## Considered options

- A custom folder layout
- Diátaxis for documents, MADR for decisions
- A single long README

## Decision outcome

Diátaxis for `docs/`, MADR for `docs/adr/`, and `AGENTS.md` as the entry file for agents.

Many projects use both formats, so a new contributor or agent knows where to look. A custom layout needs explaining first. A single README would break the rule that the README stays short.

## Consequences

- Each document has one job: tutorial, how-to, reference or explanation.
- Every architecture decision gets a record with its reason.
- Sections that describe a working tool stay empty until there is one.
