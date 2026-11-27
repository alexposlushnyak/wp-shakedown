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
| [0018](0018-a-profile-is-a-list-of-engines.md) | A profile is a list of engines | Superseded by 0028 |
| [0019](0019-depth-is-a-filter-on-engines.md) | Depth is a filter on engines | Superseded by 0027 |
| [0020](0020-user-checks-live-in-the-home-folder.md) | Checks the user writes live in the home folder | Accepted |
| [0021](0021-the-hub-keeps-projects-in-a-file.md) | The hub keeps its projects in a file | Accepted |
| [0022](0022-experimental-engines.md) | Experimental engines are off until the user turns them on | Superseded by 0031 |
| [0023](0023-the-envato-profile-swaps-the-theme-check-release.md) | The envato profile runs Envato's fork inside the theme-check engine | Accepted |
| [0024](0024-site-health-through-wp-cli.md) | Site Health runs through WP-CLI and leaves the database as it was | Accepted |
| [0025](0025-bundled-php-is-opt-in.md) | The bundled PHP is opt-in, through WP_SHAKEDOWN_PHP | Accepted |
| [0026](0026-folders-from-the-system-dialog-and-zip-files.md) | Projects come from the folder dialog of the system and from ZIP files | Accepted |
| [0027](0027-levels-0-to-10.md) | A run has a level from 0 to 10 | Accepted |
| [0028](0028-presets-are-files.md) | Presets are a list of engines, a level and a threshold, and user presets are files | Accepted |
| [0029](0029-no-taint-engine-yet.md) | No taint engine yet: WPCS finds the output, wp-shakedown finds where it is hidden | Accepted |
| [0030](0030-a-wordpress-folder-is-tested-as-an-install.md) | A WordPress folder is tested as an install, not as the code of every theme and plugin in it | Accepted |
| [0031](0031-one-review-engine-and-directory-rules.md) | One review engine holds the rules of wp-shakedown, and a preset switches on the rules of a directory | Accepted |

## Adding a record

1. Copy the newest record and take the next number.
2. Fill in the context, the options and the outcome. Keep it to one decision.
3. Add a row to the table above.

An accepted record is not edited to change its decision. Write a new record and mark the old one as superseded.
