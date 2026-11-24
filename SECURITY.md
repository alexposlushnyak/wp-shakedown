# Security policy

## Supported versions

There is no release yet. Once there is, the latest release is the supported one.

## Reporting a vulnerability

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**, or use [this link](https://github.com/alexposlushnyak/wp-shakedown/security/advisories/new).

Do not open a public issue for a security problem.

Include what you found, how to reproduce it, and the version or commit you tested. You will get a reply in the advisory thread.

## Scope

wp-shakedown runs on your machine, reads your files and starts other tools. Reports about any of the following are in scope:

- the local web server accepting requests it should not
- a run writing to the WordPress install under test
- a crafted theme, plugin or site making the tool execute code or leak files
