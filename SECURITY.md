# 回報安全問題

發現安全漏洞的話，請私下回報，不要開公開的 issue。

到這個 repo 的 **Security** 分頁，點 **Report a vulnerability**，寫下你發現了什麼、怎麼重現。只有維護者看得到回報內容。

線上的遊戲在 https://critical-answer.vercel.app ，Worker 在 `critical-answer.aiko-studio.workers.dev`。請不要對它們跑壓力測試或自動掃描工具。

Found a security problem? Please report it privately through the **Security** tab → **Report a vulnerability**, not in a public issue.

## 主持人的 Anthropic API key

- key 只存在那個房間的記憶體（Durable Object）。不寫進房間快照、不寫進 log、不傳給任何畫面；主持人頁只看得到最後 4 碼。
- 伺服器先用 `GET /v1/models` 驗證，通過才啟用。Anthropic 拒絕（401/403）時立刻丟掉這把 key，改回腳本旁白。
- 「記住這台電腦」只存在主持人自己的瀏覽器（localStorage）。沒勾就不存。
- 房間換主持人時（主持人離開太久），前一位的 key 和用量一起清掉。
- 每個房間有句數上限（預設 300）。站長請替伺服器的 `ANTHROPIC_API_KEY` 在 Anthropic Console 設花費上限。
