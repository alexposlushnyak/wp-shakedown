# How to cut a release

For the maintainer. A release is a version in `package.json`, an entry in the changelog, a git tag, a GitHub release and a package on npm.

## One-time setup

The first version went to npm by hand, because npm sets up trusted publishing only for a package that exists.

After that first publish, open the package settings on npmjs.com and add a trusted publisher:

| Field | Value |
|---|---|
| Publisher | GitHub Actions |
| Repository | `alexposlushnyak/wp-shakedown` |
| Workflow | `release.yml` |

From then on the Release workflow publishes, and no npm token is stored anywhere.

## Each release

1. Pick the version by [Semantic Versioning](https://semver.org/). Before 1.0 a breaking change raises the minor number.
2. On a branch, set it:

   ```bash
   npm version 0.2.0 --no-git-tag-version
   ```

3. In `CHANGELOG.md`, move the entries from Unreleased under a heading for the version with today's date, and update the two links at the bottom.
4. Check the package the way a user gets it:

   ```bash
   npm run build
   npm test
   npm pack
   ```

   Install the `.tgz` in an empty folder and run `npx wp-shakedown --version` and one real run. A test checks the list of files, and this step checks that they work together.
5. Open a pull request, review it and merge it.
6. Tag the merge commit and publish a GitHub release for the tag, with the changelog entry as its text:

   ```bash
   gh release create v0.2.0 --title "0.2.0" --notes-file notes.md
   ```

7. The Release workflow runs the checks and publishes to npm with provenance. Watch it finish, then confirm:

   ```bash
   npm view wp-shakedown version
   ```

## If something goes wrong

- The workflow fails before the publish step: fix it on `main`, delete the GitHub release and the tag, and start again from step 6.
- A broken version is on npm: publish a fixed patch version. npm does not let a version number be used twice, and unpublishing breaks people who installed it. `npm deprecate wp-shakedown@0.2.0 "Use 0.2.1"` warns them.
