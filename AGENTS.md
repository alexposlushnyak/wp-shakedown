# AGENTS.md

Instructions for AI coding agents working in this repository. Humans should start with [README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Project

wp-shakedown is a local test runner for WordPress themes, plugins and installs. It orchestrates existing tools, runs outside WordPress, and produces one report. Stack: Node.js and TypeScript, one npm package.

The core, the report writers, the `run`, `ui` and `mcp` commands and twelve engines exist. Profiles select the engines for one gate.

## Commands

You need Node.js 22.18 or newer. The engine tests also need PHP and Composer. Without them those tests are skipped. The first test run downloads the tools into `.cache/`, which takes about a minute.

| Command | What it does |
|---|---|
| `npm install` | Installs the dev dependencies of the tool |
| `npm install --prefix ui` | Installs what the web page needs to build |
| `npm run typecheck` | Type-checks `src` and `test` |
| `npm run build` | Compiles `src` to `dist` and builds the web page into `ui/dist` |
| `npm run build:core` | Compiles `src` only |
| `npm run dev --prefix ui` | Starts Vite for work on the page. Run `wp-shakedown ui` next to it for the API |
| `npm test` | Runs the tests with the Node test runner |

Node runs the TypeScript sources directly, so tests need no build. Write TypeScript that Node can strip: no enums, no namespaces, no parameter properties, and `.ts` in relative imports.

The package has one runtime dependency, `ajv`, which the `wp-json` engine uses to validate JSON against a schema. Add another only when an engine needs it, and say why in the pull request. The MCP SDK is a development dependency: the tests use its client to check our hand-written server.

Tests keep tools and reports in `.cache/` through `WP_SHAKEDOWN_HOME`. A test must not write to `~/.wp-shakedown`.

To add an engine: write the adapter in `src/engines/`, add it to `src/engines/index.ts`, test its parser without the tool and its run with the tool, and describe it in `docs/reference/engines.md`.

## Layout

| Path | Holds |
|---|---|
| `src/types.ts` | The finding and run result types. Every other file builds on them |
| `src/target.ts` | Works out what a path is |
| `src/runner.ts` | Runs engines and builds the result |
| `src/engines/` | One adapter per external tool |
| `src/php/` | What the PHP engines share: finding PHP, installing the tools, running PHPCS |
| `src/health/` | What the install engines share: reading versions and packages from a WordPress folder |
| `src/net.ts` | Cached requests to public services. Tests replace its fetch and never use the network |
| `php-tools/` | The Composer manifest and lock file for the PHP tools, and the script that runs Theme Check |
| `src/engines/custom.ts` | Turns the check files in `~/.wp-shakedown/checks` into engines |
| `src/projects.ts` | The list of projects in `~/.wp-shakedown/projects.json` |
| `src/hub.ts` | Runs several projects at once |
| `src/profiles.ts` | The profiles: which engines run for which gate |
| `src/js/` | What the JavaScript and CSS engines share: installing the tools, finding source files |
| `js-tools/` | The npm manifest, lock file and configs for ESLint and Stylelint |
| `src/report/` | The four report writers |
| `src/cli.ts` | The `wp-shakedown` command |
| `src/session.ts` | The steps from a path to a written report, shared by the command and the web page |
| `src/ui/server.ts` | The local server and its API |
| `src/mcp/` | The MCP server and its tools |
| `ui/` | The web page: React, Tailwind and shadcn/ui, built with Vite |
| `test/` | Tests, one file per source file |

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

## The web page

The page is built from shadcn/ui components. Do not hand-write a control that shadcn/ui has. Add a component with `npx shadcn@latest add <name>` inside `ui/`, or through the shadcn MCP server set up in `.mcp.json`. Logic that does not need the browser goes into `ui/src/lib/run.ts`, where the root tests cover it.

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
| [docs/reference/](docs/reference/cli.md) | The command line and the report format |
| [docs/explanation/](docs/explanation/architecture.md) | How the tool is designed and why |
| [docs/adr/](docs/adr/README.md) | Architecture decision records |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each release |
| [docs/how-to/release.md](docs/how-to/release.md) | How the maintainer cuts a release |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to report, propose and contribute |

## AI disclosure

AI agents write most of this project. The maintainer directs the work and reviews it. A commit made with an agent carries a `Co-Authored-By` trailer that names the agent.

The project was started with Claude Fable 5.2 from Anthropic, running in Claude Code. When the model changes, update this line.
