# 公開 repo 前的清單

`chihgeorge/critical-answer` 從 private 改成 public 之前要確認的事。2026-10-28 用 `/cso --infra` 加上全歷史掃描整理，同一天全部做完並公開。

狀態：✅ 已完成　🙋 要你決定（已決定的寫在後面）　⚙️ 要你在 GitHub／Cloudflare／Vercel 設定裡做

## 密鑰

- ✅ **歷史裡沒有真的密鑰。** 掃了所有本機分支和 GitHub 上全部 90 個 PR head（`refs/pull/*`，公開後任何人都拿得到，包括已刪掉的分支），用三種方法：
  - 拿本機 `.env`、`.env.cloudflare.local`、`.dev.vars` 裡的實際值去比對：`ANTHROPIC_API_KEY`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`OWNER_KEY` 全部 0 筆。
  - 常見金鑰前綴（`sk-ant-`、`ghp_`、`github_pat_`、`AKIA`、`xoxb-`、`PRIVATE KEY`）和 `OWNER_KEY=`／`CLOUDFLARE_API_TOKEN=` 後面接長字串：只有文件裡的 `sk-ant-...`、`OWNER_KEY=...` 佔位字。
  - 高熵字串掃描（含 key／token／secret／auth 的新增行裡的長亂碼，涵蓋換過的舊金鑰）：只找到 `package-lock.json` 的 sha512 雜湊和一個測試假值。
- ✅ **沒有 `.env*`、`.dev.vars`、`*.pem`、`local-banks/` 的檔案曾經被 commit 過**（刪掉的檔案也查了）。
- ✅ `.gitignore` 確實擋住 `.env*`、`.dev.vars`、`/local-banks/`（`git check-ignore` 驗證過）。
- ✅ 正式環境的 `OWNER_KEY` 是 Cloudflare secret，從來不在 repo 裡。本機 `.dev.vars` 的那把也沒進過歷史。
- ✅ Cloudflare 帳號 ID 不在任何追蹤中的檔案或歷史裡。
- ✅ GitHub repo 沒有任何 Actions secret 或 variable。

## CI、部署和 GitHub 設定

- ✅ **GitHub Actions**：`ci.yml` 只聽 `pull_request` 和 `push` 到 `main`，沒有 `pull_request_target` 或 `workflow_run`，權限是 `contents: read`，repo 預設 workflow 權限也是 read。fork 開的 PR 拿不到任何密鑰（本來也沒有），也寫不了 repo。
- ✅ **Cloudflare Workers Builds**：唯一的 trigger 只建 `main`（2026-10-28 用 API 確認過）。「Builds for Preview branches」2026-10-02 已關掉，所以 fork 或其他分支不會觸發建置。
- ✅ **Dependabot alerts 和 security updates** 已打開（2026-10-28，你同意後改的）。有已知漏洞的套件會發警示並自動開修補 PR；`.github/dependabot.yml` 原本只做每週版本更新。
- ✅ **只允許 squash merge**（2026-10-28）。merge commit 和 rebase 已關掉。
- ✅ **Actions 只允許 GitHub 官方和 verified 的 action**（2026-10-28）。`ci.yml` 用的 `actions/checkout`、`actions/setup-node`、`actions/upload-artifact` 都是官方的。
- ✅ 只有你一個 collaborator，沒有 deploy key。`npm audit --omit=dev` 0 個漏洞（2026-10-28）。

## 內容

- ✅ **LICENSE**：MIT（這個 PR 新增，`package.json` 也加了 `"license": "MIT"`，README 底部加了「授權」）。
- ✅ **文件裡的本機路徑**：`docs/designs/` 的 `/Users/<使用者名稱>/...` 改成 `~/...`（這個 PR）。幾份設計文件引用的 gstack 檔名裡還有使用者名稱（例如 `<使用者名稱>-main-design-….md`），保留：名字本來就在 LICENSE 和 commit 作者裡。
- ✅ **`wrangler.jsonc`**：R2 網址旁邊的舊註解還寫「這是佔位字」，改成說明 fork 要換成自己的 bucket 網址和 `ALLOWED_ORIGINS`。
- ✅ **`TODOS.md`**：拿掉「本機檔案存有可用的 API token」這種不必要的細節。
- ✅ **README**：玩法、快速開始、部署、題庫、專案結構、已知限制都有，外人看得懂。全中文，沒有另寫英文版。
- ✅ **`local-banks/`**（你自己寫的活動題）：被 `.gitignore` 擋住，從來沒進過歷史。
- ✅ `docs/designs/img/` 的兩張 PNG 是首領階段的設計稿，沒有個資。
- 🙋→✅ **`data/question-bank.json`（預設 84 題，含答案）**：決定照樣公開。辦活動用的是 `local-banks/` 和題庫編輯器存的題，預設題被看到沒關係。注意：歷史裡每一版的預設題都會公開，包括已刪掉的 `docs/question-bank-2026-taiwan.md`。
- 🙋→✅ **commit 作者 email**：你的 gmail 決定公開。
- 🙋→✅ **主機名和本機路徑留在舊 commit**：2026-09-17～09-22 有 43 個 commit 的作者和 committer email 是本機的使用者名稱加主機名，歷史裡也有 27 行本機路徑。決定不改寫歷史：GitHub 的 PR refs 會永遠保留舊 commit，只有開新 repo 才清得乾淨，不值得。之後的 commit 已經用 gmail。
- ✅ **公開本來就公開的東西**：`critical-answer.aiko-studio.workers.dev`、`critical-answer.vercel.app`、R2 的 `pub-….r2.dev` 網址。瀏覽器本來就拿得到，不是密鑰。
- ✅ **記憶筆記**（`~/.claude/projects/.../memory/`）在 repo 外面，不會被公開。裡面有帳號 ID 和 email，不要複製進 repo。

## 公開前要你做（2026-10-28 全部完成）

1. ✅ **Webhooks**：GitHub → Settings → Webhooks 是空的，沒有任何東西會把 repo 事件送到外面。
2. ✅ **Vercel**：確認 fork 的 PR 要你同意才會建 preview、拿到環境變數（Vercel 預設就是這樣）。
3. ✅ **Cloudflare**：Workers & Pages → critical-answer → Settings → Builds → Previews Base，「Builds for Preview branches」確認是關的。
4. ✅ **CI artifact**：5 個 `playwright-results` artifact（E2E 失敗時的截圖和 trace）公開前已刪掉，repo 剩 0 個。過去每次 CI run 的 log 還是看得到，裡面沒有密鑰，因為 GitHub 根本沒存密鑰。
5. ✅ **公開**：2026-10-28 改成 Public。

## 公開後馬上做（2026-10-28 全部完成，用 GitHub API 確認過）

免費方案的 private repo 不能設這些，所以公開後才做。

1. ✅ 外部貢獻者的 fork PR 一律要你按同意才跑 CI（`approval_policy: all_external_contributors`）。預設只擋第一次來的人。
2. ✅ `main` 的 branch ruleset：要求走 PR（0 個 approval，因為只有你一個人）、要求 CI 的 `check` 通過、擋 force push、擋刪除。
3. ✅ **Secret scanning** 和 **Push protection** 已打開，以後有人不小心 commit 金鑰會直接擋下。

## 這次沒涵蓋到（不擋公開）

- `/cso` 只跑了 `--infra` 範圍（密鑰、CI、部署設定）。程式碼本身的安全（`--code`）沒重跑。
- 這台電腦沒有 Docker，所以 gitleaks、zizmor、OSV-Scanner 都沒跑；上面的密鑰結果是用實際值比對、金鑰前綴和高熵字串掃描得到的。裝 Docker 後可以再跑一次 `/cso` 補上。
- GitHub Actions 是用版本標籤（`@v7`）而不是 commit SHA 釘住。Dependabot 已經會更新 actions，風險低。
- `ALLOWED_ORIGINS` 的 `https://critical-answer-*.vercel.app` 不只比對到自己的 preview：任何人都能在 Vercel 開一個叫 `critical-answer-xxx` 的專案拿到符合的網址（`lib/origin.ts` 的註解原本寫「this project only」，這個 PR 已改正）。影響小：房間本來就是知道代碼就能加入，`/api/bank` 還要 `OWNER_KEY`（Bearer token，不是 cookie，別的網站拿不到）。公開後這個規則誰都看得到，但本來就猜得到；要收緊可以改成列出確切的網址，另外處理。
