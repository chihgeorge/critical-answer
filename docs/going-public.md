# 公開 repo 前的清單

`chihgeorge/critical-answer` 從 private 改成 public 之前要確認的事。2026-10-28 用 `/cso --infra` 加上全歷史掃描整理。

狀態：✅ 已完成　🙋 要你決定（已決定的寫在後面）　⚙️ 要你在 GitHub／Cloudflare／Vercel 設定裡做

## 密鑰

- ✅ **歷史裡沒有真的密鑰。** 掃了本機全部 306 個 commit（所有分支）和 GitHub 上 88 個 PR head（`refs/pull/*`，公開後任何人都拿得到，包括已刪掉的分支）。拿本機 `.env`、`.env.cloudflare.local`、`.dev.vars` 裡的實際值去比對：`ANTHROPIC_API_KEY`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`OWNER_KEY` 全部 0 筆。只出現在文件裡的 `sk-ant-...`、`OWNER_KEY=...` 這類佔位字。
- ✅ **沒有 `.env*`、`.dev.vars`、`*.pem`、`local-banks/` 的檔案曾經被 commit 過**（刪掉的檔案也查了）。
- ✅ `.gitignore` 確實擋住 `.env*`、`.dev.vars`、`/local-banks/`（`git check-ignore` 驗證過）。
- ✅ 正式環境的 `OWNER_KEY` 是 Cloudflare secret，從來不在 repo 裡。本機 `.dev.vars` 的那把也沒進過歷史。
- ✅ Cloudflare 帳號 ID 不在任何追蹤中的檔案或歷史裡。
- ✅ GitHub repo 沒有任何 Actions secret 或 variable。

## CI 與部署（fork PR 會發生什麼）

- ✅ **GitHub Actions**：`ci.yml` 只聽 `pull_request` 和 `push` 到 `main`，沒有 `pull_request_target` 或 `workflow_run`，權限是 `contents: read`，repo 預設 workflow 權限也是 read。fork 開的 PR 拿不到任何密鑰（本來也沒有），也寫不了 repo。
- ✅ **Cloudflare Workers Builds**：唯一的 trigger 只建 `main`。「Builds for Preview branches」2026-10-02 已關掉，所以 fork 或其他分支不會觸發建置。
- ⚙️ **公開後**：GitHub → Settings → Actions → General → 「Fork pull request workflows from outside collaborators」改成 **Require approval for all outside collaborators**。預設只擋第一次來的人，改了之後每個外人的 PR 都要你按同意才跑 CI。
- ⚙️ **公開後**：幫 `main` 加 branch ruleset（擋 force push、擋刪除、要求 CI 通過）。免費方案的 private repo 不能設，公開後才能開。
- ⚙️ **公開後**：Settings → Code security 打開 **Secret scanning** 和 **Push protection**（public repo 免費），以後有人不小心 commit 金鑰會直接擋下。
- ⚙️ **Vercel**：Project → Settings → Git，確認 **Git Fork Protection** 是開的（預設開）。這樣 fork 的 PR 要你同意才會建 preview、拿到環境變數。
- ⚙️ **Cloudflare**：Workers & Pages → critical-answer → Settings → Builds → Previews Base，再確認「Builds for Preview branches」還是關的。

## 內容

- ✅ **LICENSE**：MIT（這個 PR 新增，`package.json` 也加了 `"license": "MIT"`，README 底部加了「授權」）。
- ✅ **文件裡的本機路徑**：`docs/designs/` 的 `/Users/georgechih/...` 改成 `~/...`（這個 PR）。
- ✅ **`wrangler.jsonc`**：R2 網址旁邊的舊註解還寫「這是佔位字」，改成說明 fork 要換成自己的 bucket 網址。
- ✅ **README**：玩法、快速開始、部署、題庫、專案結構、已知限制都有，外人看得懂。全中文，沒有另寫英文版。
- ✅ **`local-banks/`**（你自己寫的活動題）：被 `.gitignore` 擋住，從來沒進過歷史。
- 🙋→✅ **`data/question-bank.json`（預設 84 題，含答案）**：決定照樣公開。辦活動用的是 `local-banks/` 和題庫編輯器存的題，預設題被看到沒關係。注意：歷史裡每一版的預設題都會公開，包括已刪掉的 `docs/question-bank-2026-taiwan.md`。
- 🙋→✅ **commit 作者 email**：`chihgeorge@gmail.com` 決定公開。
- 🙋→✅ **主機名和本機路徑留在舊 commit**：2026-09-17～09-22 的 86 個 commit 作者是 `georgechih@Georges-Mac-mini.local`，歷史裡也有 27 行本機路徑。決定不改寫歷史：GitHub 的 PR refs 會永遠保留舊 commit，只有開新 repo 才清得乾淨，不值得。之後的 commit 已經用 gmail。
- ✅ **公開本來就公開的東西**：`critical-answer.aiko-studio.workers.dev`、`critical-answer.vercel.app`、R2 的 `pub-….r2.dev` 網址。瀏覽器本來就拿得到，不是密鑰。
- ✅ **記憶筆記**（`~/.claude/projects/.../memory/`）在 repo 外面，不會被公開。裡面有帳號 ID 和 email，不要複製進 repo。

## 最後一步

- ⚙️ 上面 ⚙️ 的設定做完之後，GitHub → Settings → General → Danger Zone → **Change repository visibility** → Public。

## 這次沒涵蓋到（不擋公開）

- `/cso` 只跑了 `--infra` 範圍（密鑰、CI、部署設定）。程式碼本身的安全（`--code`）沒重跑。
- 這台電腦沒有 Docker，所以 gitleaks、zizmor、OSV-Scanner 都沒跑；上面的密鑰結果是用實際值比對和常見金鑰前綴掃出來的。裝 Docker 後可以再跑一次 `/cso` 補上。
- GitHub Actions 是用版本標籤（`@v7`）而不是 commit SHA 釘住。Dependabot 已經會更新 actions，風險低。
- `ALLOWED_ORIGINS` 的 `https://critical-answer-*.vercel.app` 不只比對到自己的 preview：任何人都能在 Vercel 開一個叫 `critical-answer-xxx` 的專案拿到符合的網址（`lib/origin.ts` 的註解寫「this project only」不正確）。影響小：房間本來就是知道代碼就能加入，`/api/bank` 還要 `OWNER_KEY`。跟公不公開無關，另外處理。
