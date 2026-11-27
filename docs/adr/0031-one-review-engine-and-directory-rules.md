# 0031. One review engine holds the rules of wp-shakedown, and a preset switches on the rules of a directory

- Status: Accepted
- Date: 2026-11-27
- Supersedes: [ADR 0022](0022-experimental-engines.md)
- Refines: [ADR 0023](0023-the-envato-profile-swaps-the-theme-check-release.md), [ADR 0028](0028-presets-are-files.md)

## Context and problem statement

The rules wp-shakedown writes itself had spread over three engines: `theme-review`, `activation-lock` and `theme-fonts`. Font licenses sat in one, font files in another. An engine should mean one thing a user understands: one outside tool, such as PHPCS or Stylelint, or the set of rules of wp-shakedown. On top of that, three settings decided what runs: levels, presets and an experimental flag. And many of the rules are requirements of the wordpress.org directory or of ThemeForest, which a theme made for a client does not have to meet.

## Considered options

- Keep separate engines per topic
- One engine per directory (`wporg-review`, `envato-review`)
- One `review` engine whose rules carry their own kinds, level and directories, with the directory set by the preset

## Decision outcome

One engine, `review`, runs on themes and plugins. Each rule names the kinds it fits, the lowest level that runs it, and the directories that require it, if any. A rule without directories runs whenever the level reaches it: a font file that does not exist is a defect in any theme. A rule with directories runs when the preset names one of them in its `directory` field, `wporg` or `envato`, or at level 10. `directory: 'envato'` also makes `theme-check` run Envato's fork, and replaces the `themeCheck` field of ADR 0028.

The experimental flag goes. Levels already say how far a run goes, and the directory says which marketplace's rules apply. `--experimental` stays as an old name that raises the level to at least 7.

## Consequences

- `theme-review`, `activation-lock` and `theme-fonts` are gone. Their findings now come from `review` with the same rule names, so their finding IDs change once.
- The built-in presets `wporg-theme` and `wporg-plugin` set `directory: 'wporg'`, `envato` sets `directory: 'envato'`, `client` sets none.
- A preset file with `themeCheck: "envato"` reads as `directory: "envato"`.
