# What theme reviewers ask for

The `review` engine has rules that do not come from a handbook. They come from a study of what reviewers of the wordpress.org theme directory wrote in review tickets. This document describes the study, so you can judge how much weight a finding of those rules deserves.

## The study

Every theme submitted to the directory gets a ticket on [themes.trac.wordpress.org](https://themes.trac.wordpress.org). A reviewer reads the theme and lists what the author has to change.

| | |
|---|---|
| Tickets read | 1,500, the newest closed tickets of new themes |
| Created | 30 April 2026 to 23 November 2026 |
| With a review written by a person | 878: 292 ended live, 586 not approved |
| Reviewers | 28 |
| Closed with no review | 91, most because the author already had a theme in the queue |

The comments of the reviewers were sorted into categories with regular expressions, and samples of the unsorted rest were read by hand until it held little more than greetings and design remarks.

## What comes up

Share of the 878 reviews that raise the point. One review can raise many.

| Point | Share |
|---|---|
| Licenses and sources of bundled images, fonts and libraries missing from the readme | 31% |
| Keyboard use and visible focus | 31% |
| Theme URI and Author URI | 30% |
| Other accessibility points: links in content without underline, headings, contrast | 26% |
| Skip link missing or not visible | 24% |
| Text that cannot be translated | 23% |
| Version headers: Tested up to, values that differ between `style.css` and the readme | 23% |
| Menu or navigation that does not work | 19% |
| Screenshot that does not show the theme | 19% |
| Upsell and promotion | 18% |
| Format and sections of `readme.txt` | 18% |
| Tags in `style.css` | 17% |
| No copyright notice for the theme in the readme | 17% |
| Prefixes | 17% |
| Output that is not escaped | 15% |

Remarks about design came up in 36% of the reviews. They are specific to each theme, and the study left them out.

## What the engine checks

A rule made it into the engine when reviewers raise the point often, a tool can see it in the files, and Theme Check and the WordPress Coding Standards do not report it already. [Engines](../reference/engines.md#review) lists the rules.

Several frequent points are not in the engine, because files alone do not show them: keyboard focus, menus that do not work, and whether the screenshot shows the theme. Those need a browser and a running WordPress.

Three more points are in the engine: admin notices that the user cannot dismiss, a redirect after activation, and a `readme.txt` that is not in English. Prefixes are checked by the `wpcs` engine.

## Limits

- One reviewer wrote about half of the 878 reviews and works from a fixed list. Some points are frequent mostly because of that list.
- The sorting was done with regular expressions. Spot checks put it at 60 to 90 percent right, depending on the category. Read the shares as sizes, not as measurements.
- The study does not tell required points from recommended ones. Reviewers mark them in different ways.
- It covers seven months of 2026. Older tickets and open tickets were not read.
- The rules are heuristics. A finding of this engine is a question a reviewer may ask, and it can be wrong. That is why no finding of the engine is an error.
