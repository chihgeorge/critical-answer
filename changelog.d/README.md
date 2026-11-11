# changelog.d

Each PR adds one file here, `<branch-slug>.md`, instead of editing `VERSION` or `CHANGELOG.md`.
It opens with front matter that names the version part this change raises, then the body is exactly what the
CHANGELOG section will hold (`### Added`, `### Fixed`, ...), with no `## [x]` heading:

```markdown
---
bump: minor
---
### Added
- ...
```

The version is MAJOR.MINOR.PATCH.MICRO. Pick the part by what the change is:

| `bump:` | When | 0.58.3.2 becomes |
|---|---|---|
| `major` | A milestone or an incompatible change (1.0, saves or banks old code can no longer read) | 1.0.0.0 |
| `minor` | A new feature players or the host can see | 0.59.0.0 |
| `patch` | A fix or improvement with no new feature, 50 or more changed lines | 0.58.4.0 |
| `micro` | A change under 50 lines: a small fix, copy, docs, config | 0.58.3.3 |

CI (`scripts/check-fragment.ts`) refuses a PR without a fragment, a fragment without one of these four `bump:`
values, and a PR that edits `VERSION`, `CHANGELOG.md` or the package versions itself.

After the merge, `.github/workflows/stamp.yml` runs `scripts/stamp-release.ts` on main: it folds every file here,
in path order, into one new `## [<version>] - <date>` CHANGELOG section, raises the highest `bump:` among them by
exactly one (the parts after it reset to 0), sets `VERSION` and the `package.json` / `package-lock.json` version,
deletes the files and pushes that release commit to main. This README is skipped.
