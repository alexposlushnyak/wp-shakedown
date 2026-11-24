# 0017. Theme Check runs without WordPress

- Status: Accepted
- Date: 2026-11-24

## Context and problem statement

Theme Check is the plugin that wordpress.org runs on every theme upload. It runs inside a WordPress admin screen or through WP-CLI. [ADR 0007](0007-defer-sandbox-wordpress.md) defers a WordPress that the tool could start, so Theme Check was waiting for the sandbox.

Its sixty checks do not need most of WordPress. Each check gets the theme as three lists of file contents and searches them as text. Outside the admin screen the checks call eleven WordPress functions, such as `__`, `esc_html`, `get_file_data` and `sanitize_title_with_dashes`. They use `WP_Theme` for the headers of `style.css` and for the list of files.

## Considered options

- Wait for the sandbox and run the plugin inside WordPress
- Run the plugin through WP-CLI on an install the user already has
- Write the same checks again as our own
- Run the check files of the plugin with plain PHP, and define the eleven functions and `WP_Theme` ourselves

## Decision outcome

`php-tools/theme-check.php` defines the eleven functions and a `WP_Theme` class with the methods the checks call. It loads `checkbase.php` from a pinned Theme Check release, runs the checks on the theme folder and prints each message as JSON. The `theme-check` engine turns the messages into findings.

The checks stay the ones wordpress.org maintains, and the project rule is to run existing tools. The stand-ins are about two hundred lines. A run takes about a second and needs PHP and nothing else.

The WP-CLI route needs a WordPress install, and Theme Check would have to be installed into it. The tool never writes to an install.

## Consequences

- A stand-in can differ from WordPress at the edges. `wp_check_filetype_and_ext` goes by the file extension and does not read the file.
- A new Theme Check release may call a function the script does not define. PHP then stops with a fatal error and the engine reports that it failed. A test runs the engine on a small theme, so a version bump that breaks the script fails in CI.
- Theme Check comes from wordpress.org through a `package` entry in `php-tools/composer.json`, pinned by version and checksum. Dependabot does not update that entry, so a new release is a manual bump.
- Theme Check writes its messages as HTML. The engine reads the label, the file name and the line numbers out of that HTML. When the markup changes, the engine has to follow.
- The list of files follows `WP_Theme::get_files()`: no names that start with a dot, no `vendor`, `node_modules` or `bower_components`. A `.DS_Store` in the theme folder is not reported, the same as when the plugin runs in WordPress.
- The script reads theme files and never loads one as code.
- The fork of Theme Check that Envato keeps for ThemeForest has the same structure, so the same script can run it.
