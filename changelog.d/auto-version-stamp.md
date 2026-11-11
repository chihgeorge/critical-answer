---
bump: patch
---
### Changed
- The version now goes up by itself after every merge. Each pull request still adds a `changelog.d/` file, which must now open with `bump: micro`, `patch`, `minor` or `major`. When it lands on main, the new `stamp.yml` workflow folds the files into one CHANGELOG section, raises exactly that one part of the version (the parts after it reset to 0), and pushes the release commit as a dedicated GitHub App, the only actor allowed past main's rules. A `minor` or `major` release then gets its GitHub Release. Before, the version only moved when someone opened a release pull request by hand, so 36 entries waited unreleased after 0.57.0.0. The rules are in `changelog.d/README.md` and `docs/development.md`.
- Release runs no longer share one queue, so a newer run can't cancel a pending `X.Y.0.0` release.

### Fixed
- The ❓ fork browser test has 60 seconds, like the other long walkthroughs. When the fortune teller came up, her intro, pick and effect card pushed it past the 30-second default.
