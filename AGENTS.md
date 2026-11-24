# AGENTS.md

Instructions for AI coding agents working in this repository. Humans should start with [README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Project

wp-shakedown is a local test runner for WordPress themes, plugins and installs. It orchestrates existing tools, runs outside WordPress, and produces one report. Stack: Node.js and TypeScript, one npm package.

The repository currently holds documentation only. No tool code exists yet.

## Before you start

1. Read [docs/README.md](docs/README.md) and the documents it links for the area you touch.
2. Read the decision records in [docs/adr/](docs/adr/README.md). An accepted decision is changed only by a new record that supersedes it.

## Rules

- Orchestrate, do not reimplement. Add a check of our own only where no maintained tool covers it.
- Never write to the WordPress install under test. Install checks are read-only.
- Every engine's output goes through the shared finding schema. No engine gets its own report path.
- Keep the README short. Detail belongs in `docs/`.
- Use English for code, comments, commits, issues and docs.
- Write every public text plainly. The Writing section below applies to docs, issues, commit messages and every string the tool prints.
- Do not bundle data or rules whose license forbids redistribution. See [ADR 0004](docs/adr/0004-license-gpl-2-or-later.md).

## Workflow

- File one issue per change before work starts, with one type label and one area label. [CONTRIBUTING.md](CONTRIBUTING.md) lists them.
- Branch as `feat/<name>`, `fix/<name>` or `chore/<name>`.
- Write [Conventional Commits](https://www.conventionalcommits.org/). One commit covers one logical unit of work, including its docs.
- Open a pull request that lists `Closes #N` for each issue. A review is posted on the pull request before it is merged.
- Update the docs in the same change: the document for the area you touched, [CHANGELOG.md](CHANGELOG.md), and a new decision record when you make an architecture decision.

## Writing

Public text here must read as if a person wrote it. Before you commit any text, check it against these rules:

- Say the thing. Cut openers, summaries of what you are about to say, and closing lines that restate the point.
- Use active voice and name who does the action. "The server picks the folder", not "the folder is chosen".
- Use "is" and "has". Skip "serves as", "features", "boasts".
- No em dashes or en dashes. Use a period, a comma or a colon.
- No bold labels at the start of list items, no emoji, sentence case in headings.
- Do not group things in threes out of habit, and do not rotate synonyms. Repeat the clear word.
- Drop filler and hedges: "in order to", "it is worth noting", "genuinely", "robust", "seamless", "leverage", "comprehensive".
- Do not tell the reader something is important or interesting. Give the fact.
- Describe what exists now. Only the changelog talks about what changed.

## Documentation map

| Path | Holds |
|---|---|
| [README.md](README.md) | What the project is, in under a minute |
| [docs/explanation/](docs/explanation/architecture.md) | How the tool is designed and why |
| [docs/adr/](docs/adr/README.md) | Architecture decision records |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each release |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to report, propose and contribute |

## AI disclosure

AI agents write most of this project. The maintainer directs the work and reviews it. A commit made with an agent carries a `Co-Authored-By` trailer that names the agent.
