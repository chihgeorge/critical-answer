---
bump: micro
---
### Changed
- Vercel deploys only `main` now (`vercel.json` `git.deploymentEnabled`): pull request branches no longer create preview deployments, so they cannot use up the daily deployment limit and block a production deploy.
