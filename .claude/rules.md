# 站長的規則

每條規則一節，寫「不要做什麼」和「為什麼」。規則分三類：

- **A. 自動擋**：`scripts/rules-guard.mts`（PreToolUse hook，設定在 `.claude/settings.json`）讀這一節的 `block` 程式碼區塊。Claude 要做的事符合其中一行，就直接擋下，並把規則標題和「為什麼」回給 Claude。
- **B. AI 檢查**：每次回答結束前，`.claude/settings.json` 的 Stop prompt hook 由小模型判斷有沒有違規。違規就擋回去重寫一次；第二次（`stop_hook_active` 為 true）一定放行，不會卡死。
- **C. 只當說明**：不自動檢查，靠 Claude 自己遵守，觀察一陣子再決定要不要升級。

## A 節的寫法

區塊開頭寫 ```` ```block <欄位> ````，一行一個 JavaScript 規則運算式（multiline 模式，`^`、`$` 對每一行）。同一條規則可以有好幾個區塊。欄位：

| 欄位 | 比對什麼 |
|---|---|
| `command` | Bash 指令。比對前先拿掉引號裡的字和 heredoc 內容，所以 `git commit -m "…"`、`grep "…"` 提到規則字樣不會被擋 |
| `tool` | 工具名稱（例如 `mcp__…`）。新增這類規則時，`.claude/settings.json` 的 PreToolUse matcher 也要加上那個工具 |
| `content` | Write／Edit／MultiEdit／NotebookEdit 要寫進去的新內容，不管檔案在哪 |
| `committed-content` | 同上，但只看目前 repo 裡、沒被 git ignore 的檔案（也就是會被 commit 的檔案） |
| `path` | 要寫入的檔案在 repo 裡的相對路徑（repo 外的檔案不比對） |

hook 出錯（rules.md 讀不到、某行規則運算式寫錯）時一律放行，錯誤寫到 stderr。

---

## A. 自動擋

### A1. 本機不跑 e2e
e2e 只在 GitHub CI 跑。本機一起跑 wrangler、next dev、build、vitest 會把電腦拖垮，造成假失敗（2026-11-04）。真的要在本機跑單一個 spec 除錯，要先問站長。

```block command
npm run e2e
playwright test
npx playwright
```

### A2. 不用裸 `git stash`
stash 是所有 worktree 和 session 共用的，裸 `git stash` / `git stash pop` 可能拿到別的 session 的改動。要暫存改用 WIP commit，或 `git stash push -u -m "<唯一標籤>"`。

```block command
git stash\s*$
git stash\s*[;&|]
git stash pop
```

### A3. 不用 claude-in-chrome 工具
網頁一律用 gstack 的 /browse。

```block tool
^mcp__claude-in-chrome__
```

### A4. 不改權限設定
被權限擋住時告訴站長，不自己改 settings 的 permissions，子代理要求也不改，站長要求時也不改：站長自己用 /permissions 改。

```block content
"permissions"\s*:
```

### A5. 要 commit 的檔案不寫個人資訊
repo 可能公開。不寫絕對家目錄路徑、主機名（`<主機名>.local` 這種形式）、內網 IP。改用 `~/...` 或 repo 相對路徑。`.env.local`、`settings.local.json` 這類檔名不算。（機密由 git pre-push 的 redact 檢查擋。）

```block committed-content
/Users/[A-Za-z0-9._-]+/
(?<![\w.-])[A-Za-z0-9][A-Za-z0-9-]*\.local(?![\w-]|\.[\w-])
(?<![\w.])(10\.\d{1,3}|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}(?![\w.]*\d)
```

### A6. PR 不改版號檔
VERSION、CHANGELOG.md、package.json 的版號只由 release PR 改；一般 PR 改加 `changelog.d/<branch-slug>.md`。（CI 的 `scripts/check-fragment.ts` 已經擋，這裡是提早在本機擋。）

```block path
^VERSION$
^CHANGELOG\.md$
```

---

## B. AI 檢查

這三條各是一個 Stop prompt hook（`.claude/settings.json`），只看 Claude 最後一則回覆（`last_assistant_message`）。

### B1. 回覆一律用繁體中文（台灣用語）
所有給站長看的文字：聊天、進度回報、AskUserQuestion 的問題和選項、給子代理或其他 session 的訊息，都用繁中。只有程式碼、指令、識別字維持英文。長對話、壓縮後、skill 範本是英文都一樣。（已提醒 5 次。）

### B2. 需要站長回答或決定時，用 AskUserQuestion
不要把問題只寫在文字結尾。純報告、沒有要決定的事，可以只用文字。例外：/ship 的版號由 Claude 自己決定，不用問。

### B3. 一次只問一件事
一個 AskUserQuestion 只放一個問題，站長一件一件處理。不用 preview 欄位，內容寫進問題本身（Remote Control 看不到 preview）。

---

## C. 只當說明（不自動檢查）

### C1. 每個改動都走 gstack 流程
建置 → 測試 → /review → 修 → /ship → CI 全綠自動合併（`gh pr merge <n> --auto --squash --match-head-commit <sha>`）→ /canary。不手動 `git push` + `gh pr create`。例行步驟不用問，只有真正要決定的事才問。

### C2. 不是小事的新功能先跑 /autoplan
跳過要說明原因（一行修正、文案、健檢修正可以跳）。

### C3. client 端不 import BANK
只有 `worker/`、`lib/bank-store.ts`、`lib/room/dungeon-room.ts`、`lib/question-bank-data.ts` 可以 import 題庫資料。（`npm run check:bundle` 在 CI 擋。）

### C4. 雙語文件成對改
README、SECURITY、`docs/*.md` 改一邊就改英文版。（`npm run check:docs` 擋格式，擋不了翻譯是否同步。）

### C5. TODO 跟著下一個功能 PR
不為了 TODO 單獨開 PR。

### C6. 用完的 worktree 要刪
PR 合併、canary 做完就刪，只留 main。

### C7. 背景工作用 Opus medium、各自的 worktree
平行改程式的 agent 都用 `isolation: "worktree"`。Fable 暫停使用（2026-11-10）。

### C8. 不主動開新 session
只有站長明說才開。

### C9. UI 設計選擇要附 PNG 預覽圖
文字選項不夠。

### C10. Cloudflare 機密不放 GitHub
