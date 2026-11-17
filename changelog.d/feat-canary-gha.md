---
bump: minor
---
### Added
- 每個發版 commit 部署完，GitHub Actions 自動在正式站跑三輪 canary（`npm run canary:live -- --rounds 3`）：先等 Vercel 和 Workers Builds 都部署成功，失敗時 run 會失敗並在標籤 `canary` 的 issue 留下版本和失敗的行，輸出存成 artifact。不再需要在本機手動跑，也不用任何密鑰。
