# Homebrew packaging

openlore is already on npm, so the Homebrew formula ([`openlore.rb`](./openlore.rb))
just installs that published tarball under a Homebrew-managed Node prefix. There
are two ways to get it in front of `brew install` users; a **personal tap** is the
practical choice and needs no approval.

## Option A — personal tap (recommended, available today)

Homebrew installs formulae from *taps* (Git repos named `homebrew-<name>`), not
from a subdirectory of a project repo. So publish the formula to a tap once:

1. Create a public repo `clay-good/homebrew-openlore`.
2. Add this formula at `Formula/openlore.rb` (copy it verbatim from here).
3. Users then install with either:

   ```sh
   brew install clay-good/openlore/openlore
   # or
   brew tap clay-good/openlore && brew install openlore
   ```

`depends_on "node"` pulls in Homebrew's Node (which satisfies openlore's
`engines: node >=22.5.0`), and `std_npm_args` installs the npm tarball into the
formula's `libexec`, symlinking the `openlore` bin onto the user's `PATH`.

## Option B — homebrew-core (wider reach, has a bar to clear)

Submitting to `homebrew-core` makes `brew install openlore` work with no tap, but
core has [notability requirements](https://docs.brew.sh/Acceptable-Formulae)
(meaningful stars/forks/watchers and a stable release history) and review latency.
Pursue this once the tap has traction; the same formula works in both places.

## One-time tap setup (walkthrough)

Do this once; after it, every tagged release updates the tap automatically (see
"Automatic updates" below).

1. **Create the tap repo.** It MUST be named `homebrew-openlore` (Homebrew maps
   `brew tap clay-good/openlore` → `github.com/clay-good/homebrew-openlore`):

   ```sh
   gh repo create clay-good/homebrew-openlore --public \
     --description "Homebrew tap for openlore"
   ```

2. **Seed the formula.** From a checkout of this repo, copy the current formula in:

   ```sh
   git clone https://github.com/clay-good/homebrew-openlore.git
   cd homebrew-openlore
   mkdir -p Formula
   # refresh url+sha to the latest published npm version, then copy it in
   ( cd /path/to/OpenLore && node scripts/update-homebrew-formula.mjs )
   cp /path/to/OpenLore/packaging/homebrew/openlore.rb Formula/openlore.rb
   git add Formula/openlore.rb
   git commit -m "openlore $(grep -oE 'openlore-[0-9.]+' Formula/openlore.rb | head -1 | cut -d- -f2)"
   git push
   ```

3. **Verify install works:**

   ```sh
   brew tap clay-good/openlore
   brew install openlore        # or: brew install clay-good/openlore/openlore
   openlore --version
   ```

4. **Enable CI auto-updates** (one secret): create a token that can push to the
   tap repo and add it to *this* repo's secrets as `HOMEBREW_TAP_TOKEN`.

   - A **fine-grained PAT** scoped to only `clay-good/homebrew-openlore` with
     **Contents: Read and write** is the least-privilege choice:
     GitHub → Settings → Developer settings → Fine-grained tokens → Generate.
   - Then:

     ```sh
     gh secret set HOMEBREW_TAP_TOKEN --repo clay-good/OpenLore
     # paste the token when prompted
     ```

   Until this secret exists, the release workflow's Homebrew step warns and skips
   (npm publishing is unaffected).

## Automatic updates (CI/CD)

The same tag-triggered release pipeline that publishes to npm
(`.github/workflows/release.yml`) updates the tap. After the `publish` job
succeeds, the `bump-homebrew` job:

1. resolves the version from `package.json`,
2. runs `scripts/update-homebrew-formula.mjs` to pin `url` + `sha256` to the
   freshly published registry tarball,
3. checks out `clay-good/homebrew-openlore` with `HOMEBREW_TAP_TOKEN` and pushes
   the updated `Formula/openlore.rb` (commit message `openlore <version>`).

So the release flow is unchanged from your side: bump `package.json`, tag `vX.Y.Z`,
push the tag — npm publishes and the tap follows automatically.

## Manual bump (if ever needed)

`scripts/update-homebrew-formula.mjs` pins the formula to a published version by
fetching the registry tarball and computing its sha256:

```sh
node scripts/update-homebrew-formula.mjs            # uses package.json version, edits in place
node scripts/update-homebrew-formula.mjs --version 2.0.17
# or via npm:
npm run homebrew:formula
```

Then `brew install --build-from-source ./openlore.rb` + `brew test openlore`
against the tap confirm it builds and `openlore --version` matches.

> The `url`/`sha256` are pinned to a specific published version on purpose —
> Homebrew requires a content hash for a fixed artifact, so the formula is
> updated per release rather than tracking "latest".
