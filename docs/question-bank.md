繁體中文 | [English](question-bank.en.md)

# 題庫指南

題庫怎麼改、格式規則、出問題怎麼救。

## 預設題庫

題庫在 [data/question-bank.json](../data/question-bank.json)：8 個房間各一隻怪物（難度 1／2／2／3／4／4／5／5），題目放在難度 1–5 五個題庫（難度 2 有 16 題，其他各 12 題），加上首領的 20 題，共 84 題，全部是四選一選擇題（玩家在手機上作答，主持人按「公布答案」後遊戲判定），所以用預設題庫不會擲說服檢定（見[完整規則](rules.md#說服檢定)）。題庫編輯器存過題庫的環境會繼續用存檔的那份，這個檔只在還沒存過題庫時使用（見下面的[題庫編輯](#題庫編輯)）。伺服器啟動時會載入並驗證（缺 id、重複 id、空題目或答案、難度不在 1–5、怪物不是圖鑑裡的 id、小怪放在首領或首領放在房間都會直接報錯），**只有伺服器會讀這個檔**，瀏覽器只收得到題目文字，收不到答案。`npm run check:bundle` 會檢查這一點。

**怪物圖鑑**：題庫裡每間房和首領的怪物只存圖鑑 id（例如 `"slime-soft"`），名字、造型、顏色和打倒後煮成的菜都由 [lib/monster-catalog.ts](../lib/monster-catalog.ts) 決定，題庫不能自己寫。目前圖鑑有 20 隻小怪和 3 隻首領（`dragon` 深淵小黑龍、`kraken` 深海大王烏賊、`phoenix` 不死火鳥），每隻都有自己的造型和料理圖，完整名單和 id 見 `lib/monster-catalog.ts`；預設題庫的 8 間房用 8 隻不同的小怪（`slime-soft` 軟趴趴史萊姆、`mushroom-crumbly` 碎碎蘑菇、`ghost-shy` 害羞幽靈、`snail-slow` 慢吞吞蝸牛、`bat-hanging` 倒掛蝙蝠、`ghost-cry` 愛哭幽靈、`mimic` 寶箱怪、`skeleton-rattle` 喀啦骷髏兵），首領是深淵小黑龍。題庫最上層加 `"randomMonsters": true`（題庫編輯器的「每場隨機抽怪」）時，上面指定的怪物不用：每場開局重新抽，每間房一隻不重複的小怪（房間比小怪多時才會重複），首領從 3 隻裡抽一隻，玩久了每隻出場次數差不多。預設題庫有打開這個開關。小怪只能放在房間，首領只能放在首領欄。同一隻小怪可以放在好幾間房：第一次出場是原樣，之後每被打倒一次，下一次出場就換一種小變化（換顏色、頭上戴一個配件、名牌多一個稱號，例如「戴王冠的軟趴趴史萊姆」）。每一隊走進房間時就決定這隻怪的樣子，到離開那間房都不變，別隊之後打倒同一種怪也不影響。同一場遊戲裡順序固定，首領不會變。設計見 [docs/designs/monster-catalog.md](designs/monster-catalog.md)。

新增題目時：難度 1–5 每個題庫至少 12 題（最多 8 隊同時各拿著一題，多留 4 題讓逃跑換題時一定有沒人拿著的題）；首領題庫建議至少「首領血量 + 10」題（每次打中和每次答錯都會用掉一題；最後一個階段的題用完後會重出已經公布過答案的題，前面的階段用完就直接換下一階段）；題目文字不能含自己或題庫裡任何一題的答案（大螢幕是共用的）；任兩題的題目和答案都不能重複（`lib/question-bank.test.ts` 會檢查）。

> 預設的 84 題是 AI 起草的，其中 52 題使用者 2026-10-25 看過，v0.14.0.0 新增的 20 題還沒看過，v0.15.0.0 新增的 12 題首領題也沒有使用者看過的紀錄；裡面有 2026 年的時事題，**開局前請主持人覆核答案**。

## 題庫編輯

`/bank-editor` 是主持人專用的題庫編輯頁，首頁下方有連結，也可以直接打網址進入；不在遊戲的實際玩法流程裡。頁面右上角有「← 回首頁」。有還沒儲存的修改時，回首頁、重新整理、關分頁、按上一頁或按「載入題庫」都會先確認。上方分頁切換「房間」、「難度 1–5」題庫和「首領」。「房間」頁設定每間房的難度（決定從哪個題庫抽題）和獎勵分，以及首領每打中一下的獎勵分，每間房和首領的怪物從圖鑑的下拉選單選（房間只列小怪，首領只列首領），選單旁邊顯示造型和這隻怪會煮成的菜；題庫頁可以新增、修改、刪除**填空題、選擇題和排序題**，頁首會寫哪幾間房從這個題庫抽題；「首領」頁按「新增階段」可以把首領戰分成幾個階段，每個階段設定名稱、規則、血量（1–20 的整數，大螢幕一點血畫一顆心）和自己的題目；第 2 階段起名稱和規則必填，空白時欄位會標紅、不能存檔；刪除還有題目的階段會先確認。題庫格式號碼現在是 4（加了排序題）：有排序題的題庫存成格式 4，沒有的照舊存成格式 3；格式 3 的題庫照常讀。格式 1、2 的舊題庫這版不讀：編輯器顯示黃色提示，畫面上是預設題庫，儲存鍵可以按，按了會把舊題庫蓋掉；要留舊題庫，見下面的[題庫卡住時怎麼救](#題庫卡住時怎麼救)。部署途中前端比 Worker 先更新時，編輯器拿到舊格式的題庫會顯示紅色「伺服器還是舊版，等部署完成再重新載入。」並停用儲存。存過的題庫保留自己的首領題，不會自動拿到預設題庫新增的首領題。每題的題目可以是文字、上傳的圖片或 YouTube 影片，另外可以加一段同樣可選媒材的詳解，答對後跟答案一起顯示。選擇題最多 4 個選項（大螢幕只有 4 格），由玩家在 `/play` 上點選並鎖定，主持人按「公布答案」後伺服器依正確選項判定，主持人不用判對錯（見[完整規則](rules.md#選擇題)、[docs/designs/multiple-choice-questions.md](designs/multiple-choice-questions.md) 與 [docs/designs/phone-answering.md](designs/phone-answering.md)）。排序題在題型選「排序」，題目寫排序規則（例如「依年齡由大到小排」），下面四格照正確順序填，四格都要填、不能重複；遊戲裡會自動打亂，玩家在手機上拖拉排序，四個位置全對才算答對（見[完整規則](rules.md#排序題)）。舊題庫裡超過 4 個選項的題目仍可載入、照常遊玩，但要先刪到 4 個才能存檔。題目 id 超過 64 個字元的題庫也存不了檔（手機送不出這題的答案）；編輯器自己產生的 id 不會這麼長。圖片會上傳到 Cloudflare R2，`/play` 和 `/screen` 都會顯示；換圖、刪題，或上傳後沒存檔的圖片，都會在等過一段寬限期（確保還在進行的局不會突然少圖）之後自動清掉。題庫實際存在 Cloudflare Durable Object（`BankStore`），編輯即時生效；`BankStore` 連不上時，新開的房間會自動改用 bundle 裡的 `data/question-bank.json`，編輯器則載入不了也存不了，圖片上傳回 503。存檔會做版本檢查，別人同時改過會擋下（409），避免互相覆蓋。存著的題庫這一版讀不懂時（例如回滾到比題庫格式舊的版本），編輯器一載入就會顯示紅色的唯讀提示，畫面上是 bundle 裡的預設題庫，儲存鍵停用，圖片上傳會被擋（409），圖片也暫停清理；存著的題庫保持原樣，見下面的[題庫卡住時怎麼救](#題庫卡住時怎麼救)。

**YouTube 題與聽歌題**：題目是圖片或 YouTube 時，可以另外填「題幹」（最多 200 字），大螢幕、手機和主持人頁都顯示在圖片或影片上方；文字題本身就是題目，不能再填題幹。YouTube 題可以填開始和結束時間（打 `1:05` 或 `65` 都可以，存成秒數；結束留空就播到完），按「▶ 試聽片段」在編輯器裡直接聽。勾「只放聲音（聽歌題）」時，大螢幕用一張像素卡蓋住影片畫面，只放聲音，公布答案時才露出畫面（有圖片或影片詳解時改顯示詳解）；詳解欄的影片不能勾。影片只在大螢幕播，由主持人頁的 ▶ 播放、⏸ 暫停、⟲ 從頭控制，手機不嵌影片。注意：YouTube 的使用規範不允許把聲音和畫面分開，聽歌題只適合私人活動。很多唱片公司的 MV 關掉了嵌入，大螢幕會顯示「影片無法播放」；活動前請用主持人頁的 ▶ 在大螢幕實際試放一次。設計見 [docs/designs/youtube-questions.md](designs/youtube-questions.md)。

圖片上傳要先設定 R2，見 [部署指南](deployment.md#圖片上傳r2)。

頁面要輸入 `OWNER_KEY` 才能讀寫題庫，伺服器端沒設這把密鑰時一律回 403（本機開發要在 `.dev.vars` 加一行 `OWNER_KEY=...` 才能測，`.dev.vars.example` 沒有內建）；正式部署要用 `wrangler secret put OWNER_KEY` 設一組 ≥32 bytes 的隨機值，太短會在 Worker log 留警告。

**對局紀錄**：每場遊戲結束時（首領被打倒，或主持人按「結束冒險」），只要至少有一隊答過一題，伺服器就存一筆紀錄到題庫的 Durable Object，同時在 Worker log 印一行 `game_log`。紀錄有開始和結束時間、隊數、每隊的隊名、職業、名次、進度分、飽足感、總回合數、第幾輪進首領房、自己走了幾回合才進去，以及進首領房要的分數、每間房和首領的獎勵分、首領每個階段的血量、打到第幾階段、剩幾滴血、首領戰打了幾輪。一輪是每隊各走一次。紀錄沒有題目和答案。只保留最新的 1000 場，更舊的會被刪掉。這版部署前就開始的場次會標 `partial: true`，它的回合數只算部署之後走的。存不進去時只在 Worker log 留 `game_log_failed`，遊戲照常進行。輸入 `OWNER_KEY` 後按「⬇ 下載對局紀錄（JSON）」，就能把留著的場次下載成一個 JSON 檔，用來調首領血量或進首領房的分數。

## 題庫卡住時怎麼救

編輯器出現「存著的題庫這個版本讀不懂」時，你的題庫還在 `BankStore` 裡，沒有被蓋掉，只是目前部署的程式讀不懂它的格式。這段期間開的遊戲會用預設題庫。

1. **最常見：回滾到比題庫格式舊的版本。** 往前部署回存題庫的那個版本或更新的版本（`main` 合併後會自動部署；要手動的話在 Cloudflare dashboard 的 Worker「Deployments」頁把那個版本設為目前版本）。部署好之後重新載入編輯器，提示就會消失。
2. **不要回滾到 v0.13.1.0 以前。** 更舊的版本沒有這個保護，讀不懂題庫時會直接用預設題庫存檔，把你的題庫蓋掉。`lib/bank-store.ts` 的 `BANK_FORMAT` 加過 1 之後，底線變成 **v0.15.0.2**：v0.13.1.0～v0.15.0.1 不看格式號碼，會把新欄位存掉。存過排序題之後（格式 4），回滾到加入排序題以前的版本：編輯器會變唯讀、新開的遊戲用預設題庫，正在進行、用到排序題的房間也會重開；沒有排序題的題庫存成格式 3，回滾照常讀得懂。
3. **真的是存著的資料壞了**（Worker log 有 `bank_store_corrupt`，而且部署的已經是最新版）：先從 log 的錯誤訊息找出是哪一題、哪個欄位不合格式，再修正 Durable Object 裡存的值。修之前先把原值備份下來。
4. **黃色提示「正式站題庫是舊格式（格式 N）」**：題庫是 v0.40 以前存的（格式 1、2，怪物是整隻存在題庫裡），這版不讀舊格式。畫面上是新的預設題庫，按「儲存」會把舊題庫蓋掉（舊題庫的圖片留在 R2 14 天才刪，轉好的題庫要在這之前存回去）；這段期間新開的房間用預設題庫。要保留舊題庫的題目，在 repo 根目錄照下面做（`local-banks/` 是 git-ignored）：
   1. **升級之前**先備份（新版上線後 `GET /api/bank` 只回預設題庫，拿不到舊的）：
      ```bash
      mkdir -p local-banks && curl -fsS -H "Authorization: Bearer $OWNER_KEY" https://<你的 Worker>/api/bank > local-banks/prod-backup-2026-11-07.json
      ```
   2. 把備份裡的怪物換成圖鑑 id。舊編輯器不能改怪物名字，所以舊題庫的怪物一定是下表 9 隻之一；換色的和不在圖鑑裡的對到同一種造型的原版。對不到的名字會停下並印出來：
      ```bash
      node -e '
      const fs = require("fs");
      const ID = { "軟趴趴史萊姆": "slime-soft", "害羞幽靈": "ghost-shy", "迷路史萊姆": "slime-soft", "愛哭幽靈": "ghost-cry", "守門史萊姆王": "slime-soft", "暴躁幽靈": "ghost-shy", "熔岩史萊姆王": "slime-soft", "冰霜愛哭鬼": "ghost-cry", "深淵小黑龍": "dragon" };
      const bank = JSON.parse(fs.readFileSync(process.argv[1])).bank;
      const toId = (m, where) => { const id = typeof m === "string" ? m : ID[m && m.name]; if (!id) { console.error("對不到：" + where + " " + JSON.stringify(m)); process.exit(1); } return id; };
      bank.rooms.forEach((r, i) => { r.monster = toId(r.monster, "rooms[" + i + "]"); });
      bank.boss.monster = toId(bank.boss.monster, "boss");
      fs.writeFileSync(process.argv[2], JSON.stringify(bank, null, 2));
      ' local-banks/prod-backup-2026-11-07.json local-banks/prod-converted.json
      ```
   3. 升級後，用存著的 version 把轉好的題庫存回去（版本對不上會回 409，重抓 version 再試）：
      ```bash
      V=$(curl -fsS -H "Authorization: Bearer $OWNER_KEY" https://<你的 Worker>/api/bank | node -pe 'JSON.parse(require("fs").readFileSync(0)).version')
      node -e 'const fs=require("fs");process.stdout.write(JSON.stringify({bank:JSON.parse(fs.readFileSync(process.argv[1])),version:+process.argv[2]}))' local-banks/prod-converted.json "$V" | curl -fsS -X PUT -H "Authorization: Bearer $OWNER_KEY" -H "Content-Type: application/json" --data-binary @- https://<你的 Worker>/api/bank
      ```
   4. 重新載入編輯器：黃色提示消失，每間房的選單顯示原來的怪物。
