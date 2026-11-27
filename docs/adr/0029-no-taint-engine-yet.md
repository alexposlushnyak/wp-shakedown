# 0029. No taint engine yet: WPCS finds the output, wp-shakedown finds where it is hidden

- Status: Accepted
- Date: 2026-11-27

## Context and problem statement

Issue #102 asked for unescaped output that reaches the page through a wrapper function, a method, a variable set elsewhere, or user input several calls away. WPCS `EscapeOutput` looks at each `echo`, `print` and `printf` on its own. The question was whether a taint analysis, which follows a value from where it enters to where it leaves, finds more.

A spike compared Psalm 7 with `--taint-analysis`, WPCS 3.4 and PHPStan with the WordPress extension on a fixture theme with nine cases, and ran Psalm on Twenty Twenty-One.

## Considered options

- A `taint` engine on Psalm with stubs that mark the WordPress escaping functions
- A rule of our own for PHPStan
- Keep WPCS for output, and report the comments that switch its escaping check off

## Decision outcome

wp-shakedown builds no taint engine for now. The `wpcs` engine reports the `phpcs:ignore`, `phpcs:disable` and `@codingStandardsIgnore` comments that switch off `EscapeOutput` on output, as the rule `escaping-suppressed`.

In the spike WPCS reported every unescaped case, wrappers and methods included, because it flags the output itself and not the source of the value. Psalm found no case WPCS missed. It knows where a value came from, so it can drop findings for escaped values and show the path from input to output, but it missed output in an HTML attribute and knew no WordPress escaping function without a stub file of our own. It adds about 95 MB of tools and used 383 MB of memory on Twenty Twenty-One, where it found nothing. PHPStan has no taint analysis, and writing one is a project of its own.

What lets unescaped output through in practice is a comment that tells WPCS to look away. A comment without a reason is a warning. A comment with a reason after `--` is a note, because escaped output passed through a helper is a real case for one.

## Consequences

- `escaping-suppressed` runs with `wpcs`, at level 5, and needs no new tool.
- The spike report is local (`.dev/research/2026-11-26-taint-spike.md`). A Psalm engine stays possible at level 8 with a stub file for the WordPress escaping functions. Revisit it after a run on five to ten real themes and plugins shows findings WPCS misses.
