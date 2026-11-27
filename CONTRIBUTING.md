# Contributing

Thanks for looking. The project is in early development, so the most useful contributions right now are bug reports about the docs and ideas about what the tool should check.

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## Report a problem or suggest something

- Something is wrong: open a [bug report](https://github.com/alexposlushnyak/wp-shakedown/issues/new?template=bug_report.yml).
- You want a check or a feature: open a [feature request](https://github.com/alexposlushnyak/wp-shakedown/issues/new?template=feature_request.yml).
- A reviewer asked you for something the tool did not catch: link the ticket in a feature request, or [add a review case](docs/how-to/add-a-case.md) yourself.
- You have a question: start a [discussion](https://github.com/alexposlushnyak/wp-shakedown/discussions).
- You found a security issue: follow [SECURITY.md](SECURITY.md). Do not open a public issue.

## Change something

1. Open an issue first, or pick an existing one. One issue per change.
2. Branch from `main` as `feat/<name>`, `fix/<name>` or `chore/<name>`.
3. Commit with [Conventional Commits](https://www.conventionalcommits.org/), for example `fix(report): keep finding IDs stable across runs`. One commit covers one logical unit of work, including its docs.
4. Run `npm install` and `npm install --prefix ui`, then `npm run typecheck`, `npm run build` and `npm test`. You need Node.js 22.18 or newer.
5. Update the docs the change makes stale, and add a line to [CHANGELOG.md](CHANGELOG.md) under Unreleased.
6. Open a pull request and list `Closes #N` for each issue.

Read [docs/explanation/architecture.md](docs/explanation/architecture.md) and the [decision records](docs/adr/README.md) before proposing a change to how the tool works.

## Labels

Every issue gets one type and one area. The issue forms set the type. The maintainer adds the area.

| Type | Meaning |
|---|---|
| `bug` | Something does not work as documented |
| `feature` | A new check or capability |
| `polish` | A small improvement to something that works |
| `refactor` | A change in structure with no change in behaviour |
| `chore` | Docs, tooling, repository upkeep |

| Area | Meaning |
|---|---|
| `backend` | Core, engines, CLI, MCP server |
| `frontend` | Local web page |
| `content` | Documentation |
| `ops` | Repository, CI, releases |

## AI-assisted contributions

AI agents write most of this project, and you can use one for your contribution too. It gets the same review as any other change. If an agent wrote your change, say so in the pull request. Agents working in this repository follow [AGENTS.md](AGENTS.md).

## License

By contributing, you agree that your contribution is licensed under [GPL-2.0-or-later](LICENSE).
