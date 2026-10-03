# Releasing

Releases go to npm as `@taljacob2/runtime-config`, through **staged
publishing**: CI holds only a *stage-only* token, which can put a version up
for review but can't publish it. A version goes live only when a maintainer
approves it with two-factor authentication (2FA). A leaked CI token therefore
can't get a version onto npm on its own.

Requirements: an npm account with 2FA enabled and publish access to the
package. CI installs npm 11.15 or later itself (`npm stage` needs it).

## The first release (once, by hand)

npm can only stage a version of a package that **already exists**, so the very
first version (`0.1.0`) is published directly, by you, with 2FA. From a clone,
in Git Bash or any POSIX shell (the checks run `sh`):

```sh
npm ci
npm login                      # as the owner of the @taljacob2 scope
npm publish --access public    # runs `npm run verify` first, then asks for your 2FA code
```

(A version published by hand carries no provenance statement; every staged
version from CI does.)

Then tag it. The workflow sees `0.1.0` is already on npm, skips staging, and
creates the GitHub release:

```sh
git tag 0.1.0
git push origin 0.1.0
```

## The stage-only token (once)

1. On npmjs.com: **Access Tokens** -> **Generate New Token** -> **Granular Access Token**.
2. Under packages and scopes, choose **Read and write (stage only)** for
   `@taljacob2/runtime-config`, and give it an expiry date.
3. Save it as the repository secret `NPM_TOKEN` - the command asks for the
   value, so it never lands in your shell history:

   ```sh
   gh secret set NPM_TOKEN -R taljacob2/runtime-config
   ```

A stage-only token can also deprecate versions and move dist-tags, but it can
never publish a version directly.

## Every later release

1. Move the changes under a new version heading in `CHANGELOG.md`.
2. Set the same version in `package.json` (`npm version <x.y.z> --no-git-tag-version`).
3. Commit both, and push to `main`. Wait for CI to pass.
4. Tag it with the bare version - no `v`: `0.2.0`, `1.2.0-beta.1` - and push the tag:

   ```sh
   git tag <x.y.z>
   git push origin <x.y.z>
   ```

5. The `Release` workflow checks that the tag matches `package.json`, runs
   `npm run verify`, **stages** the version (`npm stage publish --provenance`),
   and creates a **draft** GitHub release. Its run summary shows how to approve.
6. Approve it with 2FA, on npmjs.com (the package's **Staged Packages** tab) or
   from a terminal:

   ```sh
   npm stage list @taljacob2/runtime-config
   npm stage view <stage-id>       # optional: inspect it first
   npm stage approve <stage-id>    # asks for your 2FA code - now it's live
   ```

   To drop it instead: `npm stage reject <stage-id>`.
7. Publish the draft GitHub release.

The repository's `.npmrc` sets `tag-version-prefix=""`, so if you let
`npm version` make the tag, it makes the same bare one.

Publishing is public and can't be fully undone: npm allows an unpublish only
within 72 hours, and a version number - staged or published - can never be
reused.

## Later: no token at all

npm's trusted publishing (OIDC from GitHub Actions) can be limited to staging
too, which removes the `NPM_TOKEN` secret entirely. See
[staged publishing](https://docs.npmjs.com/staged-publishing) and
[trusted publishers](https://docs.npmjs.com/trusted-publishers).
