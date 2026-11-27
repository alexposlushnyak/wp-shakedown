# Add a review case

The `cases/` folder holds the requests that reviewers of wordpress.org and ThemeForest make again and again, each with the ticket where they made it. `test/cases.test.ts` runs every case, so the base also says what wp-shakedown catches. See [ADR 0035](../adr/0035-a-base-of-review-cases.md).

## Write the case

Make a folder `cases/<id>/` with a `case.json`:

```json
{
  "id": "skip-link-missing",
  "title": "No skip link to the main content",
  "summary": "The reviewer asks for a link at the top of the page that jumps to the main content.",
  "sources": ["https://themes.trac.wordpress.org/ticket/273559"],
  "category": "accessibility",
  "kinds": ["theme"],
  "tags": ["wporg"],
  "status": "caught",
  "expect": { "engine": "review", "rule": "skip-link", "level": 7, "directory": "wporg" },
  "checked": "2026-11-27"
}
```

Write the summary in your own words and link the ticket. The status says what the tool does with the case:

| Status | Meaning | Needs |
|---|---|---|
| `caught` | An engine reports it | `expect` with the engine, the rule, and the level and directory the run uses |
| `assistant` | A [check for an assistant](../reference/assistant.md) is listed for it | `assistant` with the ID of the check, and `run` with the level and directory |
| `open` | The tool does not cover it yet | `note` with the reason, for example that it needs a browser |

`category` is one of `security`, `accessibility`, `i18n`, `licensing`, `readme`, `assets`, `review-process`, `plugin-territory`, `settings`, `compatibility` or `other`. `checked` is the date you last confirmed the case against the tool.

## Add the fixture

A `caught` or `assistant` case needs `cases/<id>/fixture/`: the smallest theme or plugin that shows the problem. Give it a full `style.css` header or plugin header, so the tool detects it, and nothing else the rule does not need.

## Run it

```bash
node --test test/cases.test.ts
```

The test fails when a `caught` case is not reported, when an `assistant` case is not listed, or when two cases have the same ticket and the same rule. Cases that need PHP are skipped on a machine without PHP and Composer.

When you write a new rule, start with the case: the fixture that fails without the rule is its first test.
