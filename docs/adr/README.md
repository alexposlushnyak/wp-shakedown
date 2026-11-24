# Architecture decision records

Each record states one decision, the options that were considered, and the reason for the choice. Records use the [MADR](https://adr.github.io/madr/) format.

| # | Decision | Status |
|---|---|---|
| [0001](0001-document-with-diataxis-and-madr.md) | Document with Diátaxis and MADR | Accepted |
| [0002](0002-orchestrate-existing-tools-outside-wordpress.md) | Orchestrate existing tools from outside WordPress | Accepted |
| [0003](0003-node-typescript-single-package.md) | Node.js and TypeScript in one npm package | Accepted |
| [0004](0004-license-gpl-2-or-later.md) | License under GPL-2.0-or-later | Accepted |
| [0005](0005-normalized-finding-schema.md) | One finding schema, SARIF as an export | Accepted |
| [0006](0006-php-runtime-user-choice.md) | The user chooses the PHP runtime | Accepted |
| [0007](0007-defer-sandbox-wordpress.md) | Defer the disposable WordPress sandbox | Accepted |
| [0008](0008-finding-ids-without-line-numbers.md) | Finding IDs leave out the line number | Accepted |
| [0009](0009-reports-outside-the-target.md) | Reports are written outside the target | Accepted |
| [0010](0010-install-php-tools-with-composer.md) | Install the PHP tools with Composer on first run | Accepted |
| [0011](0011-style-findings-do-not-fail-a-run.md) | Style findings do not fail a run | Accepted |
| [0012](0012-plugin-check-rules-inside-wpcs.md) | The Plugin Check review rules run inside the wpcs engine | Accepted |
| [0013](0013-javascript-and-css-tools.md) | JavaScript and CSS tools are installed on first use and run with our config | Accepted |
| [0014](0014-local-web-page.md) | The local web page is a built React page with shadcn/ui, fed by server-sent events | Accepted |
| [0015](0015-install-health-without-a-running-site.md) | Install health works from files and public data, without a running site | Accepted |
| [0016](0016-mcp-server-written-by-hand.md) | The MCP server speaks the protocol by hand | Accepted |
| [0017](0017-theme-check-without-wordpress.md) | Theme Check runs without WordPress | Accepted |
| [0018](0018-a-profile-is-a-list-of-engines.md) | A profile is a list of engines | Accepted |
| [0019](0019-depth-is-a-filter-on-engines.md) | Depth is a filter on engines | Accepted |
| [0020](0020-user-checks-live-in-the-home-folder.md) | Checks the user writes live in the home folder | Accepted |

## Adding a record

1. Copy the newest record and take the next number.
2. Fill in the context, the options and the outcome. Keep it to one decision.
3. Add a row to the table above.

An accepted record is not edited to change its decision. Write a new record and mark the old one as superseded.
