### Added
- CI now checks every pull request against the release flow: it must add a `changelog.d/` file and must not change `VERSION`, the `package.json` or `package-lock.json` version, or `CHANGELOG.md` (`scripts/check-fragment.ts`). A `release/*` branch skips the check, and a Dependabot pull request needs no `changelog.d/` file.
