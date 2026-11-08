# changelog.d

Each PR adds one file here, `<branch-slug>.md`, instead of editing `VERSION` or `CHANGELOG.md`.
The body is exactly what the CHANGELOG section will hold (`### Added`, `### Fixed`, ...), with no `## [x]` heading.
A feature opens with front matter that raises the bump:

```markdown
---
bump: minor
---
### Added
- ...
```

The release PR (`gstack-release-stamp open`) folds every file here into one new CHANGELOG section,
sets `VERSION` and the `package.json` version, and deletes the files. This README is skipped.
Policy: `.gstack/ship-policy.json` (`changelog_fragments` + `merge: direct`).
