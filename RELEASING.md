# Releasing

Releases go to npm as `@taljacob2/runtime-config`, with
[provenance](https://docs.npmjs.com/generating-provenance-statements), from
the `Release` workflow.

## Every release

1. Move the changes under a new version heading in `CHANGELOG.md`.
2. Set the same version in `package.json` (`npm version <x.y.z> --no-git-tag-version`).
3. Commit both, and push to `main`. Wait for CI to pass.
4. Tag and push the tag:

   ```sh
   git tag v<x.y.z>
   git push origin v<x.y.z>
   ```

The workflow checks that the tag matches `package.json`, runs `npm run verify`,
publishes, and creates the GitHub release.

## Before the first release

The workflow publishes with the repository secret `NPM_TOKEN`:

1. Sign in at npmjs.com as the owner of the `@taljacob2` scope.
2. Create a granular access token that can publish `@taljacob2/runtime-config`.
3. Save it as the repository secret `NPM_TOKEN`
   (`gh secret set NPM_TOKEN -R taljacob2/runtime-config`).

Alternatively, publish the first version by hand (`npm login`, then
`npm publish --access public`), and afterwards switch the workflow to
[trusted publishing](https://docs.npmjs.com/trusted-publishers), which needs no
token at all.

Publishing is public and can't be fully undone: npm allows an unpublish only
within 72 hours, and a published version number can never be reused.
