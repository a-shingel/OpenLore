# Homebrew formula for openlore.
#
# openlore is published to npm (https://www.npmjs.com/package/openlore); this
# formula installs that published tarball under a Homebrew-managed Node prefix,
# so `brew install` users get the same bits as `npm i -g openlore` without
# needing a global npm setup.
#
# This file is the canonical source. Homebrew installs formulae from taps, not
# from this directory, so the release pipeline pushes this formula into the
# clay-good/homebrew-openlore tap on every tagged release (the bump-homebrew job
# in .github/workflows/release.yml regenerates `url` + `sha256` via
# scripts/update-homebrew-formula.mjs). See packaging/homebrew/README.md for the
# one-time tap setup and the manual bump command.
class Openlore < Formula
  desc "Deterministic structural code-context substrate for coding agents"
  homepage "https://github.com/clay-good/OpenLore"
  url "https://registry.npmjs.org/openlore/-/openlore-2.0.16.tgz"
  sha256 "350c24fa7cec2b3df6ca58b316948df9fef939f497a12d72fe24e1cfdbb775e8"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/openlore --version")
  end
end
