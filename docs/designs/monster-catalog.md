# 怪物圖鑑與小變化（issue #139）

狀態：eng review 與 design review 完成（2026-11-07）。PR1 在 v0.40.0.0 上線；PR2 在 `feat/monster-catalog-pr2` 實作（v0.42.0.0）。審查對象：GitHub issue #139（chihgeorge/critical-answer#139），規格原文如下。

## 規格原文（issue #139，審查前）


### Context

題庫編輯人現在可以改每一關的料理文字，怪物則整隻寫在題庫 JSON 裡（名字、造型 `sprite`、色相 `hue`、料理）。內建 9 隻怪物只用 6 種造型，靠換色區分，投影機上不好認（Codex 美術研究，2026-11-07）。TODOS 的 P1「打名字，AI 產生怪物和料理的像素圖」估 L（CC 1–2 天），風險高，趕不上 11/18。站長 2026-11-07 改方向：我們先做好固定的圖鑑，編輯人只能挑。

站長已定（不再問）：

- D1：小怪 20 隻，一隻一種造型，全部不同。沿用 5 隻（slime、slime-lost、slime-king、ghost、ghost-cry），新畫 15 隻。（設計審查 R4 改成：拿掉 slime-lost、slime-king，沿用 3 隻、新畫 17 隻。）
- D2/D3：首領 3 隻，跟小怪分開：深淵小黑龍＋新畫 2 隻。
- 編輯人只能替每一關、首領選圖鑑裡的怪物，不能自訂名字或料理。
- D4：小變化 = 換色＋配件＋稱號。D5：每打倒一次就換；第一次登場原樣。首領不套配件。
- D6：舊格式題庫不支援，要重建。正式站上線時重新種子。

### Current State（2026-11-07 在 main 0e30ea9 上確認）

- `lib/sprite-kind.ts`：`MONSTER_SPRITES` 有 6 種（slime、slime-lost、slime-king、ghost、ghost-cry、dragon）；`DISH_SPRITE: Record<MonsterSprite, SpriteKind>` 每種造型一道料理圖。
- `lib/question-bank.ts:66` `BankMonster = { name, sprite, hue, dish? }`，寫在每個 room 和 boss 裡；`parseMonster`（:116）檢查名字、造型、料理字數（`DISH_LIMITS` :63）。
- `data/question-bank.json`：8 房＋首領共 9 隻怪物；暴躁幽靈（ghost 300°）、熔岩史萊姆王（slime-king 330°）、冰霜愛哭鬼（ghost-cry 180°）只是換色。
- `app/bank-editor/page.tsx:451`：名字和造型不能改，料理四格可改（`DishFields`）；`:182` 依 `unreadable` 切唯讀，`:353` 顯示紅色唯讀提示。
- `lib/question-bank.ts:447`：出題時把 `monster: { name, sprite, hue }` 帶進 STATE；`reveal.dish` 帶 `monster`（v0.39）。
- `components/pixel.tsx:144`：`Sprite` 用 CSS `filter: hue-rotate()` 換色，作用在整個 canvas。
- `lib/bank-store.ts`：`BANK_FORMAT = 2`（:44）。`read()`（:148）在 format > BANK_FORMAT **或 parseBank 失敗**時回傳 bundle 預設題庫並標 `unreadable`（:158–164）；`putBank` 遇到 `unreadable` 一律拒絕（:176）。`worker/index.ts:184` 依 `unreadable` 擋圖片上傳。
- `lib/room/snapshot.ts:124` `parseSavedBank`：房間存檔裡的題庫副本讀不懂就丟掉。

**坑（controller 查到）：** 新程式的 `parseBank` 讀不懂舊格式（monster 是物件），`read()` 就把正式站題庫標成 `unreadable`，`putBank` 拒絕覆蓋。照現在的程式，連 `PUT /api/bank` 重新種子都會失敗。本規格第 5 節定出路。

| 項目 | 現在 | PR1 後 | PR2 後 |
|------|------|--------|--------|
| 圖鑑小怪 | — | 3 隻（現有造型） | 20 隻 |
| 圖鑑首領 | — | 1 隻（dragon） | 3 隻 |
| 怪物造型 | 6 | 6 | 23 |
| 料理圖 | 6 | 6 | 23 |
| 題庫存什麼 | 整隻怪物＋料理 | 圖鑑 id | 圖鑑 id |
| 編輯器 | 可改料理 | 只能選怪物 | 只能選怪物 |
| 重複登場 | 完全一樣 | 換色＋配件＋稱號 | 同左 |

### Proposed Change

#### 1. 圖鑑 `lib/monster-catalog.ts`（新檔，純資料，可進 client bundle）

不得 import `lib/question-bank-data.ts`、`data/question-bank.json` 或任何 server-only 檔（`worker/`、`lib/bank-store.ts`、`lib/room/dungeon-room.ts`）；只 import `lib/sprite-kind.ts`。

```ts
export interface CatalogMonster {
  id: string;            // 穩定 id，kebab-case，上線後不改
  name: string;          // 顯示名，例如「軟趴趴史萊姆」
  sprite: MonsterSprite; // 每隻一種，全圖鑑不重複
  hue: number;           // 基本色相 0–359（現有 3 隻和新畫的都是 0）
  boss: boolean;
  dish: BankDish;        // 名字、部位、做法、評語（沿用 DISH_LIMITS）
}
export const MONSTERS: readonly CatalogMonster[];
export function monsterById(id: string): CatalogMonster | undefined;
```

`BankDish`、`DISH_LIMITS` 從 `lib/question-bank.ts` 搬到 `lib/monster-catalog.ts`（question-bank 反過來 import），避免圖鑑 import 題庫檔。

##### 全部 23 隻（站長 2026-11-07 看 PNG 確認，見 decision ledger R4）

小怪（`boss: false`）：

| # | id | 名字 | sprite | 造型 | 料理圖 | PR |
|---|----|------|--------|------|--------|----|
| 1 | `slime-soft` | 軟趴趴史萊姆 | `slime` | 現有：綠色水滴、頭頂兩片葉 | `dish-jelly` | 1 |
| 2 | `ghost-shy` | 害羞幽靈 | `ghost` | 現有：白色幽靈、臉紅 | `dish-ice` | 1 |
| 3 | `ghost-cry` | 愛哭幽靈 | `ghost-cry` | 現有 | `dish-riceball` | 1 |
| 4 | `mushroom-crumbly` | 碎碎蘑菇 | `mushroom` | 紅傘白點、短腳、小眼睛 | `dish-mushroom-skewer`（烤蘑菇串） | 2 |
| 5 | `bat-hanging` | 倒掛蝙蝠 | `bat` | 紫色圓身、張開的翅膀、小尖牙 | `dish-wings`（酥炸蝙蝠翅） | 2 |
| 6 | `skeleton-rattle` | 喀啦骷髏兵 | `skeleton` | 頭骨＋短身、手拿骨頭 | `dish-bone-soup`（骷髏大骨湯） | 2 |
| 7 | `mimic` | 寶箱怪 | `mimic` | 木頭寶箱、張嘴有舌頭 | `dish-bento`（寶箱便當） | 2 |
| 8 | `spider-fuzzy` | 毛毛蜘蛛 | `spider` | 黑色毛球、八條短腳、大眼睛 | `dish-cotton-candy`（蛛絲棉花糖） | 2 |
| 9 | `snail-slow` | 慢吞吞蝸牛 | `snail` | 螺旋殼、伸出觸角 | `dish-escargot`（焗烤蝸牛） | 2 |
| 10 | `wisp` | 鬼火精 | `wisp` | 藍色火焰、兩顆白眼 | `dish-brulee`（鬼火烤布蕾） | 2 |
| 11 | `golem-pebble` | 小石魔像 | `golem` | 方塊石頭身、苔蘚、發光眼 | `dish-stone-pot`（魔像石燒鍋） | 2 |
| 12 | `jellyfish-deep` | 地底水母 | `jellyfish` | 半透明傘、垂下觸手 | `dish-jelly-salad`（涼拌水母絲） | 2 |
| 13 | `frog-swamp` | 沼澤胖蛙 | `frog` | 圓胖綠蛙、大嘴 | `dish-three-cup`（三杯田雞） | 2 |
| 14 | `candle` | 蠟燭精 | `candle` | 融化的白蠟燭、頭上一朵火 | `dish-fondue`（蠟燭起司鍋） | 2 |
| 15 | `mandrake` | 尖叫曼德拉草 | `mandrake` | 根莖身體、頭頂葉子、張嘴尖叫 | `dish-root-stew`（曼德拉根菜燉） | 2 |
| 16 | `eyeball` | 浮游眼球 | `eyeball` | 大眼球、血絲、小翅膀 | `dish-tangyuan`（眼球湯圓） | 2 |
| 17 | `crab-iron` | 鐵殼螃蟹 | `crab` | 紅色硬殼、大鉗子 | `dish-crab`（清蒸鐵殼蟹） | 2 |
| 18 | `dice` | 骰子怪 | `dice` | 白色方塊骰子、點數當眼睛 | `dish-tofu`（骰子豆腐） | 2 |
| 19 | `pumpkin` | 南瓜頭 | `pumpkin` | 橘色大南瓜、刻出來的眼睛和嘴、頭頂綠梗 | `dish-pumpkin-soup`（南瓜濃湯） | 2 |
| 20 | `cactus` | 刺刺仙人掌 | `cactus` | 直立綠柱、兩隻手臂、頭頂粉紅花、小花盆 | `dish-smoothie`（仙人掌冰沙） | 2 |

首領（`boss: true`，體型約 52×46，與龍相當）：

| # | id | 名字 | sprite | 造型 | 料理圖 | PR |
|---|----|------|--------|------|--------|----|
| 21 | `dragon` | 深淵小黑龍 | `dragon` | 現有 | `dish-skewer` | 1 |
| 22 | `kraken` | 深海大王烏賊 | `kraken` | 紫紅大頭、八條觸手揮舞 | `dish-squid`（大王烤魷魚） | 2 |
| 23 | `phoenix` | 不死火鳥 | `phoenix` | 火紅大鳥、尾羽是火焰 | `dish-roast-chicken`（不死鳥烤全雞） | 2 |

- 現有 4 隻（slime-soft、ghost-shy、ghost-cry、dragon）的料理文字和 hue（都是 0）照搬 `data/question-bank.json`。迷路史萊姆、守門史萊姆王（R4）和 3 隻換色怪物移除，料理一起移除。新 19 隻的料理文字在 PR2 寫，菜名照 R4 的 PNG。
- **PNG 確認關卡**：/plan-design-review 產生 PNG 到本機 `~/.gstack/projects/critical-answer/designs/monster-catalog/`（不進 git）：`roster.png`、`v2/roster.png`（名單）、`v2/accessories.png`（6 配件戴在 3 隻現有小怪上、換色後的樣子）。2026-11-07 已確認，見 decision ledger R4、R5。
- 暴躁幽靈、熔岩史萊姆王、冰霜愛哭鬼移除（料理一起移除），改由小變化提供換色。`docs/hosting.md:61` 和 `docs/designs/scoring-and-score-pools.md:130` 的怪物名單跟著改。
- `MONSTER_SPRITES` 在 PR1 不變（6 種）。`slime-lost`、`slime-king` 的造型留著，只是不進圖鑑：`components/map-strip.tsx:89` 拿 slime-king 當地圖裝飾，`lib/turn-info.ts:14` 也有它們的大小設定。PR2 加 19 種，`MONSTER_SPRITES` 變 25 種，圖鑑用其中 23 種。`DISH_SPRITE` 維持 `Record<MonsterSprite, SpriteKind>`，缺料理圖時 tsc 失敗。

#### 2. 題庫格式（BANK_FORMAT 2 → 3）

- `room.monster` 和 `boss.monster` 改成字串（圖鑑 id）：`{"monster": "slime-soft", "difficulty": 1, "reward": 1}`。
- `parseMonster(raw, where, wantBoss)`：
  - `raw` 是物件 → 丟 `題庫格式太舊：${where}.monster 是整隻怪物，這版只接受圖鑑 id（例如 "slime-soft"）。請用題庫編輯器重建。`（`where` 例如 `rooms[0]`、`boss`）
  - 不是字串、或 `monsterById` 找不到 → `${where}.monster 不是圖鑑裡的怪物：${raw}`
  - room 用到 `boss: true`、或 boss 用到 `boss: false` → `${where}.monster ${id} 只能當首領`／`只能當小怪`
- 解析後的 `Bank` 仍存 id；需要名字、造型、料理的地方一律查 `monsterById(id)`（parse 保證存在）。
- 料理一律來自圖鑑，題庫不能覆寫：`parseBank` 不再讀或檢查任何 dish 欄位（舊的 `dish` 欄位已隨物件格式一起被拒絕）。`DISH_LIMITS` 只剩 `lib/monster-catalog.test.ts` 用來檢查圖鑑本身。每隻圖鑑怪都有料理，所以 STATE 的 `cuisine` 永遠 true（「飽足感」）。
- `lib/bank-store.ts`：`BANK_FORMAT = 3`，寫入照舊存在 `BANK_KEY` 物件的 `format` 欄位。順便關掉 TODOS 的「BANK_FORMAT 沒升」。

#### 3. 小變化（D4、D5）

**計數**：`GameState`（`lib/game-state.ts:181`）新增 `defeats?: Record<string, number>`（catalog id → 這場遊戲裡被打倒的次數；缺少 = `{}`）。它跟著 `RoomSnapshot.game` 一起存，舊存檔沒有這欄當成 `{}`（照 `Team.dishes` 的先例，不升 `SCHEMA_VERSION`）。

- `RoomTemplate`（`lib/game-state.ts:138`）新增 `monsterId: string`，由 dungeon-room 建遊戲時從 `bank.rooms[i].monster` 填入（跟現在填 `dish` 同一處）。
- 在 `answerQuestion` 產生 `correct-room-advance` 結果的同一個狀態轉換裡，對答題隊伍所在房間的 `rooms[team.roomIndex].monsterId` 加 1（跟 `ate()` 加菜名同一處，`lib/game-state.ts:999`）。判定本來就以 eventId 擋重複（重送、第二台主持人裝置），同一次答對只會產生一次轉換，所以只加一次。房間是單一 Durable Object，所有判定依序執行，兩隊「同時」答對也是一前一後各加一次。
- key 是 catalog id，不是房間：同一隻怪放在第 1 房和第 4 房，共用同一個計數。
- 答錯、逃跑、首領被打中或打倒都不加。主持人重新開一場遊戲（新的 `GameState`）就是 `{}`。

**選變化**：出題時用那間房怪物的 `n = defeats[id] ?? 0`（已經被打倒幾次；被打倒 k 次之後的登場用 n=k，所以第一次被打倒後的下一次登場是 n=1）決定外觀，結果放進那題的 `pub.monster`。實作（/review 後站長 2026-11-07 選「抽到題時就固定」）：隊伍走進房間時把那時的 `defeats[id]` 記在 `Team.metDefeats`（開局是 0），整個房間都用這個數字，別隊之後打倒同一種怪不影響；舊存檔沒有這欄時用整場的 `defeats`。

```ts
export const ACCESSORIES = ["crown", "party-hat", "flower", "headband", "bow", "pirate-hat"] as const;
const TITLE = { crown: "戴王冠的", "party-hat": "慶生中的", flower: "戀愛中的",
                headband: "熱血的", bow: "打扮過的", "pirate-hat": "海盜" };
const HUE_SHIFTS = [90, 180, 300, 0] as const;
// s = FNV-1a 32-bit：h = 2166136261；對字串 `${roomCode}:${id}` 的每個 UTF-16 code unit（charCodeAt）
//     h ^= c; h = Math.imul(h, 16777619)；最後 h >>> 0（無號）。roomCode 用房間的大寫 code。
export function variantOf(roomCode: string, m: CatalogMonster, n: number): Variant | null {
  if (n === 0 || m.boss) return null;
  const s = fnv1a(`${roomCode}:${m.id}`);
  const accessory = ACCESSORIES[(s + n - 1) % 6];
  const hueShift = HUE_SHIFTS[((s >>> 8) + n - 1) % 4];
  return { accessory, hueShift, title: TITLE[accessory] };
}
```

- n=0 一律原樣（沒有配件、沒換色、沒稱號）。首領永遠 `null`。
- 同一隻怪物的配件每次都換一種；換色每 4 次輪一圈（輪到 0° 那次只有配件）。12 次後整組重來。
- 起點只看房間 code 和 id，所以同一房間 code、同樣的打倒順序，結果一定一樣；不同房間不同起點。
- `variantOf` 放在 `lib/monster-catalog.ts`（純函式）。

**STATE 送什麼**（`lib/protocol.ts:59` `PublicQuestion["monster"]`）：

```ts
monster: { id: string; name: string; sprite: MonsterSprite; hue: number; accessory?: Accessory };
```

- `name` = 有變化時 `title + 圖鑑名`（例如「海盜軟趴趴史萊姆」「戴王冠的害羞幽靈」），否則圖鑑名。名牌、旁白、`reveal.dish.monster` 都用這個名字。
- `hue` = 最終色相 =（圖鑑 `hue` ＋ `hueShift`）mod 360。
- `accessory` 只在有變化時帶。舊前端不認得 `id`、`accessory` 會忽略；新前端遇到舊 Worker 沒有 `accessory` 就當成沒配件（split-deploy-new-state-field）。
- 料理圖、菜名、菜卡不變（只有怪物本身變）。首領的 `phaseCard.monster` 照舊（首領沒變化）。

**畫配件**：

- `lib/pixel-art.ts` 新增 6 個配件 sprite（`acc-crown` 等，每個不超過 12×8）和 `HEAD_ANCHOR: Record<MonsterSprite, [x, y]>`。座標用怪物**原生 sprite 像素**（`SPRITE_SIZE` 的格子，不是放大後），左上角為原點 (0,0)，x 向右、y 向下；錨點是配件底邊中央那一格要放的位置（頭頂中央）。首領造型也要有錨點（Record 要求），但不會用到。
- 配件尺寸記在 `SPRITE_SIZE`（`[w, h]`）。對齊規則：配件左上角放在 `left = ax − floor(w / 2)`、`top = ay − h + 1`，也就是配件最下面一列落在 y = ay、中央那欄落在 x = ax。
- 配件以錨點對齊後必須整個落在怪物的 sprite 範圍內（`left ≥ 0`、`top ≥ 0`、`left + w ≤ 怪物寬`、`ay ≤ 怪物高 − 1`）（可以壓在身體上，不能超出畫布），所以版面不會因為配件位移。
- `components/pixel.tsx`：`Sprite` 加 `accessory?` prop：外層 `position: relative` 的盒子，怪物 canvas 套 `hue-rotate`，配件是另一個絕對定位、**不套 hue-rotate** 的 canvas，用同樣的整數倍放大。
- 用在：大螢幕台上的怪物（含揭曉和 🍲 上菜的第一格）、手機的怪物小圖。主持人頁只有文字名字。
- reduced motion 不影響（配件是靜態的）。

#### 4. 題庫編輯器

- 「房間」頁每一關的怪物改成一個 `<select>`（選項文字是名字），只列小怪；首領欄只列首領。選單旁邊用 `Sprite` 畫怪物和料理的小圖，下面一行唯讀的菜名。
- 移除 `DishFields`（料理四格）和它的驗證；分數一律叫「飽足感」。
- 同一隻怪物可以放在好幾關（重複登場就會有小變化）。
- 題庫狀態提示（`page.tsx:353` 附近）：
  - `unreadable`（照舊）：紅色、唯讀、儲存鍵停用。
  - `outdated`（新，見第 5 節）：黃色（`--warn` 底、`--ink` 字）：`正式站題庫是舊格式（格式 {N}），這版讀不懂。畫面上是預設題庫；按「儲存」會把舊題庫蓋掉。要留舊題庫，先照題庫指南備份。` 儲存鍵**可以按**。
- 存檔被 parseBank 拒絕時（例如有人手動 PUT 舊格式），編輯器照現有的存檔錯誤區顯示伺服器回的訊息（第 2 節「題庫格式太舊：…」）。

#### 5. 舊格式題庫的出路（bank-store）

`read()` 判斷順序（`format` 缺少 = 1）：

| 存著的 format | 處理 | 回傳 |
|---|---|---|
| `> BANK_FORMAT`（更新的版本寫的） | 照舊：不 parse | 預設題庫，`unreadable: true`，版本 1 |
| `< BANK_FORMAT`（舊的） | 不 parse | 預設題庫，`outdated: <format>`，**版本 = 存著的 version**（缺少時 1） |
| `=== BANK_FORMAT` | `parseBank`；失敗照舊 | 成功：存著的題庫；失敗：`unreadable: true` |

- `VersionedBank` 加 `outdated?: number`（舊的 format 號碼）。`GET /api/bank` 回傳 `{ bank, version, unreadable?: true, outdated?: number }`。編輯器照現在的做法把 `version` 存在 state，存檔送 `{ bank, version }`（`app/bank-editor/page.tsx:214`，不變）；`outdated` 只用來顯示黃色提示，不送回伺服器。
- `putBank`：`unreadable` 照舊拒絕；`outdated` **允許**覆蓋，版本檢查照舊用存著的 version（編輯器 round-trip 這個數字），存成 `{ bank, version: version+1, format: 3 }`。
- 圖片：`outdated` 時 parse 不了舊題庫，不知道它用了哪些圖。`putBank` 覆蓋舊題庫時用 `legacyImageKeys(raw.bank)` 取得舊題庫的圖：遞迴走過所有物件和陣列，收集 `kind === "image"` 且 `value` 是非空字串的 `value`，放進 `Set`（重複自動去掉）；其他形狀（不是物件、value 不是字串）略過，不丟錯。跟 `imageKeysOf(新題庫)` 比，新題庫還在用的不排；其餘照現有規則排進刪除佇列（已經在佇列的 key 換成新的 deleteAt）。`runImageCleanup` 在 `outdated` 時跟 `unreadable` 一樣延後（不刪）。
- 舊題庫本身：`putBank` 覆蓋 `outdated` 題庫前，先把原始舊題庫存進 DO 的 `legacyBank` key（`{ bank, format, version }`）。目前沒有讀回的 API，只是 owner 沒照指南先備份時，資料還在伺服器上（adversarial review，2026-11-07）。
- 圖片上傳（`worker/index.ts:184` `bankUnreadable`）只看 `unreadable`，`outdated` 時可以上傳。
- 開房：`outdated` 時新開的房間用 bundle 預設題庫（新格式），可以玩。
- 進行中的房間：存檔裡的舊格式題庫副本 `parseSavedBank` 讀不懂，房間醒來時存檔被丟掉。上線不在活動期間，可接受。
- 回滾：重新種子後回滾到 v0.39，舊程式看到 format 3 > 2 → `unreadable`，唯讀、開房用舊的預設題庫，存著的新題庫不會被蓋掉（現有保護）。

#### 6. 上線與重新種子清單（PR1 合併時；站長本人做，要 OWNER_KEY）

這份清單在 **PR1 合併後**執行，用的是 PR1 的圖鑑（4 隻）和 PR1 的 `data/question-bank.json`；不等 PR2。PR2 合併後不需要再種子。lane 不做這件事；PR1 的 READY 訊息附上本清單，controller 合併後請站長執行。前端和 Worker 都是合併進 `main` 後自動部署（Workers Builds、Vercel），兩邊先後不保證，所以備份一定要在**合併之前**（新 Worker 上線後 GET 只回預設題庫，拿不到舊的）。

1. **合併前，備份正式站題庫**：
   ```bash
   mkdir -p local-banks && curl -fsS -H "Authorization: Bearer $OWNER_KEY" https://critical-answer.aiko-studio.workers.dev/api/bank > local-banks/prod-backup-$(date +%F).json
   ```
   確認檔案裡有 `"version"` 和 `"rooms"`。`local-banks/` 是 git-ignored。
2. controller 合併 PR1。
3. 等兩邊部署完：Cloudflare dashboard → Workers & Pages → `critical-answer` → Deployments 最新一筆是這次的 commit；Vercel 最新 production deployment 也是。
4. **重新種子**：開 `https://critical-answer.vercel.app/bank-editor`，輸入 OWNER_KEY 載入，應看到黃色「正式站題庫是舊格式（格式 2）」提示，畫面是新的預設題庫。按「儲存」，提示消失、顯示存檔成功。
   - 替代做法（不用瀏覽器，在 repo 根目錄跑）：
     ```bash
     V=$(curl -fsS -H "Authorization: Bearer $OWNER_KEY" https://critical-answer.aiko-studio.workers.dev/api/bank | node -pe 'JSON.parse(require("fs").readFileSync(0)).version')
     node -e 'process.stdout.write(JSON.stringify({bank:require("./data/question-bank.json"),version:+process.argv[1]}))' "$V" | curl -fsS -X PUT -H "Authorization: Bearer $OWNER_KEY" -H "Content-Type: application/json" --data-binary @- https://critical-answer.aiko-studio.workers.dev/api/bank
     ```
5. **正式站驗收**（每步都看到才算過）：
   1. `curl -fsS -H "Authorization: Bearer $OWNER_KEY" https://critical-answer.aiko-studio.workers.dev/api/bank | node -pe 'const b=JSON.parse(require("fs").readFileSync(0));[typeof b.bank.rooms[0].monster, b.outdated, b.unreadable]'` 印出 `[ 'string', undefined, undefined ]`。
   2. 重新載入編輯器：沒有黃色或紅色提示；第 1 關選單顯示「軟趴趴史萊姆」，沒有料理輸入框。
   3. 開一個房間（大螢幕＋一支手機），一隊答對第 1 題：大螢幕出現正解，按「🍲 上菜」，煮出「史萊姆寒天涼拌」。
   4. 任一步失敗：先別再存檔，把結果回報 controller；回滾見下面 Rollback。
6. 站長自己的 `local-banks/my-bank.json`（主題題庫）用新編輯器重建：選怪物、貼回題目，存到正式站。

### 前置關卡（寫程式前，不算 PR 驗收）

1. `/plan-eng-review` 完成。
2. `/plan-design-review` 產生 `roster.png`、`accessories.png`（見第 1 節「PNG 確認關卡」），站長逐項用 AskUserQuestion 確認，答案寫進 `docs/designs/monster-catalog.md`（這份設計文件進 PR1）。
3. 沒確認的項目不寫程式：配件樣子沒確認，PR1 不寫配件；名單沒確認，PR2 不畫。

### Acceptance Criteria

#### PR1：圖鑑＋題庫格式＋編輯器＋小變化（只用現有 4 種造型）

1. `MONSTERS` 有 4 筆：3 筆 `boss:false`（slime-soft、ghost-shy、ghost-cry）、1 筆 `boss:true`（dragon）；sprite 互不相同；id 互不相同；每筆料理通過 `DISH_LIMITS`；料理文字與 v0.39 預設題庫相同。
2. `data/question-bank.json` 的 8 房只用這 3 隻小怪 id（會重複，重複時就看得到小變化），首領是 `dragon`；`parseBank` 通過。
3. `parseBank` 遇到 room 或 boss 的 monster 是物件時丟出以「題庫格式太舊：rooms[0].monster」開頭的訊息；id 不在圖鑑、room 用首領 id、boss 用小怪 id 時各自丟出第 2 節的訊息。
4. `BANK_FORMAT === 3`；`BankStore` 存檔寫 `format: 3`。
5. `BankStore`：存著 format 2（或沒有 format）的舊題庫時，`getVersionedBank()` 回傳預設題庫、`outdated: 2`（或 1）、存著的 version；`putBank(新題庫, 那個 version)` 成功、存成 format 3、version+1；舊題庫用到、新題庫沒用到的圖片 key 排進刪除佇列；版本不對時照舊回傳 conflict。存著 format 4 時照舊 `unreadable` 且 `putBank` 拒絕；format 3 但內容壞掉時照舊 `unreadable`。
6. 編輯器：每關一個只列 3 隻小怪的選單，首領選單只列 dragon；沒有料理輸入框；換一關的怪物、存檔、重新載入，選擇不變。`outdated` 時顯示黃色提示且儲存鍵可按；`unreadable` 時照舊紅色唯讀。
7. 小變化：一場遊戲裡同一個 id 第一次登場，STATE 的 monster 沒有 `accessory`、`name` 是圖鑑名、`hue` 是圖鑑 hue；那隻被打倒 1 次後，下一次出到它的題目有 `accessory`、`name` = 稱號＋圖鑑名、`hue` =（圖鑑 hue＋hueShift）mod 360。
8. 同一房間 code、同樣的打倒順序，`variantOf` 和 STATE 的結果一樣；`defeats` 隨 persist/restore 保留，大螢幕重新整理後名牌和配件不變。
9. 首領（dragon）任何時候都沒有 `accessory`。
10. 6 種配件 × 3 個小怪造型：配件以 `HEAD_ANCHOR` 對齊後完全落在 `SPRITE_SIZE` 內；配件不套 hue-rotate；每個配件 8–11 格寬（R5）。
11. 菜卡、手機「今晚的菜」、上菜的料理圖都用圖鑑料理；大螢幕名牌顯示有稱號的名字。
12. `npm run check:bundle` 通過：`lib/monster-catalog.ts` 進 client bundle，題目和答案仍不外漏。
13. 雙語文件同 PR 更新：`docs/question-bank.md`/`.en.md`（圖鑑、選單、格式 3、黃色舊格式提示、「題庫卡住時怎麼救」加舊格式一點）、`docs/hosting.md`/`.en.md` 怪物名單；`DESIGN.md` 記配件；`docs/designs/monster-cuisine.md` 加一段指向本規格。`npm run check:docs` 通過。
14. 正式站驗收（合併後由站長照第 6 節第 5 步做）：`GET /api/bank` 的 room.monster 是字串、沒有 outdated/unreadable；能開房玩到第一次上菜。
15. 每個新測試附 `protects / fails_when / no_claim` 註解。

#### PR2：新畫 17 隻小怪、2 隻首領、19 道料理圖

1. `MONSTERS` 有 23 筆：20 筆 `boss:false`、3 筆 `boss:true`；23 個 sprite 互不相同；每筆料理通過 `DISH_LIMITS`。
2. 圖鑑 23 筆的 sprite 互不相同（`MONSTER_SPRITES` 有 25 種，含不進圖鑑的 slime-lost、slime-king）；`DISH_SPRITE` 每種造型一道料理圖（tsc 保證）；`SPRITE_SIZE` 涵蓋 19 個新造型和 19 張料理圖（`lib/pixel-art.test.ts` 既有尺寸測試自動涵蓋）。
3. `HEAD_ANCHOR` 涵蓋 23 個造型；6 配件 × 20 小怪造型都落在畫布內（PR1 的測試自動涵蓋）。
4. 編輯器小怪選單列 20 隻、首領選單列 3 隻。
5. 預設題庫的 8 房改成 8 隻不同的小怪（可含新怪物）。
6. 新造型和料理圖都經站長看過 PNG 確認（/plan-design-review 紀錄）。站長 2026-11-07 看過 PNG（本機 `~/.gstack/projects/critical-answer/designs/monster-catalog/v3/pr2-sprites.png`，不進 repo）後確認全部採用。
7. `BANK_FORMAT` 不變（3）：PR2 只增加圖鑑 id，PR1 存的題庫照樣讀得懂。
8. 每個新測試附 `protects / fails_when / no_claim`。

### Testing Plan

| Layer | What | PR | Count |
|-------|------|----|-------|
| Unit `lib/monster-catalog.test.ts` | 圖鑑完整性（筆數、boss 數、sprite/id 不重複、料理字數） | 1（PR2 改數字） | +2 |
| Unit `lib/monster-catalog.test.ts` | `variantOf`：n=0 原樣、首領 null、決定性、連續 n 配件不重複、最終 hue mod 360 | 1 | +5 |
| Unit `lib/question-bank.test.ts` | 新格式通過；舊格式訊息；未知 id；room/boss 用錯種類（改寫既有 dish 測試） | 1 | +4 |
| Unit `lib/bank-store.test.ts` | outdated 讀取、outdated 覆蓋＋版本檢查、舊圖排刪除、format 4 仍拒絕、format 3 壞掉仍 unreadable | 1 | +5 |
| Unit `lib/room/dungeon-room.test.ts`／`persistence.test.ts` | 打倒才加計數；第二次登場有變化；首領不變；persist/restore 保留 `defeats`；舊存檔沒 `defeats` = {} | 1 | +5 |
| Unit `lib/pixel-art.test.ts` | 配件 × 小怪造型落在畫布內 | 1 | +1 |
| E2E `e2e/bank-editor.spec.ts` | 選怪物、存檔、重新載入；沒有料理欄位（改寫既有 dish 測試） | 1 | 改寫 |
| E2E `e2e/bank-editor-readonly.spec.ts` | 讀過，依 outdated／unreadable 調整 | 1 | 改寫 |
| E2E `e2e/main-line.spec.ts` 等提到怪物名或菜的 spec | 讀過並更新 | 1 | 改寫 |
| E2E | 同一隻怪第二次登場名牌有稱號 | 1 | +1 |

e2e 只在 CI 跑，本機不跑。

### Rollout / Rollback

1. 照第 6 節清單上線與重新種子（站長本人，OWNER_KEY）。
2. 活動當天（11/21）不部署。PR1 最晚 11/18 前合併並完成重新種子。
3. 回滾 PR1：revert 並等自動部署完成。舊程式看到 format 3 → 唯讀，新開的房間用舊預設題庫，可以照常玩；**進行中的房間存檔（新格式題庫副本）會失效，不要在有人玩的時候回滾**（Outside Voice 1）。要把舊題庫放回去，PUT 會被 unreadable 擋，要直接改 Durable Object 的 `bank` 值（用第 6 節第 1 步的備份，做法見 `docs/question-bank.md`「題庫卡住時怎麼救」第 3 點）。
4. PR2 只加圖鑑，不需要重新種子。回滾 PR2 時，如果正式站題庫已經用了 PR2 的新 id，舊程式（PR1）parse 失敗 → unreadable，唯讀、不覆蓋、開房用預設題庫。所以 PR2 合併後先跑過一場再用新 id。回滾 PR2 也會讓進行中的房間存檔（裡面的題庫副本若有新 id）失效，不要在有人玩的時候回滾。
5. 正式站要一直有存著的題庫（PR1 已重新種子成格式 3）：Worker 只有在沒存題庫、或存的題庫過期時才用預設題庫，而 PR2 的預設題庫已經用新 id。存用新 id 的題庫前，先確認 Worker 和 Vercel 都部署完成，再把所有開著的大螢幕、手機頁面重新整理。部署前開著的舊頁面不認得新造型，會整頁出錯（PR2 起的頁面遇到不認得的造型會改畫史萊姆，但這只保護之後的版本）。

### Effort Estimate

- PR1：圖鑑（4 筆）＋格式＋bank-store outdated：CC 約 1.5 小時；小變化（錨點、6 配件、room state、名牌）：CC 約 2–3 小時；編輯器：CC 約 1 小時；測試、雙語文件、e2e 調整：CC 約 2 小時。合計約 CC 7 小時。
- PR2：17 小怪＋2 首領造型 CC 約 6–8 小時；19 張料理圖 CC 約 3 小時；料理文字 CC 約 1 小時。合計約 CC 1–1.5 天；來不及就分批，每批加進圖鑑的造型要連料理圖一起。

### Files Reference

| File | PR | Change |
|------|----|--------|
| `lib/monster-catalog.ts` | 1, 2 | 新檔：圖鑑、`BankDish`/`DISH_LIMITS`（搬來）、`variantOf`、配件與稱號 |
| `lib/question-bank.ts:63,66,116,447` | 1 | monster 改 id、parse 檢查、出題帶變化後的 monster |
| `lib/bank-store.ts:44,148,173` | 1 | `BANK_FORMAT = 3`、`outdated`、`legacyImageKeys` |
| `lib/room/dungeon-room.ts`、`lib/room/snapshot.ts`、`lib/game-state.ts` | 1 | `defeats` 計數、persist/restore |
| `lib/protocol.ts:59` | 1 | monster 加 `id`、`accessory?` |
| `lib/pixel-art.ts`、`lib/sprite-kind.ts` | 1, 2 | PR1：`HEAD_ANCHOR`、6 配件；PR2：19 造型、19 料理圖 |
| `components/pixel.tsx`、`components/cooking.tsx`、`app/room/[code]/screen/page.tsx`、`app/room/[code]/play/page.tsx` | 1 | 畫配件 |
| `app/bank-editor/page.tsx` | 1 | 怪物選單、移除料理欄位、黃色 outdated 提示 |
| `data/question-bank.json` | 1, 2 | 改成 id 格式；PR2 換成 8 隻不同小怪 |
| `docs/question-bank.md`+`.en.md`、`docs/hosting.md`+`.en.md`、`docs/designs/monster-cuisine.md`、`docs/designs/scoring-and-score-pools.md`、`DESIGN.md`、`TODOS.md` | 1 | 文件 |

### Out of Scope

- AI 產生怪物或料理圖（原 P1 的做法，取消）
- 題庫自訂怪物名字或料理
- 表情變化
- 首領的配件或換色變化
- 讀取或轉換舊格式題庫（D6：重建）
- 正式站重新種子（站長做，不是 lane 的工作）

---

## Eng review 紀錄（/plan-eng-review，2026-11-07）

### Scope Challenge B（範圍紀錄）

feature answers: 無刪減（站長 D1–D6 已定）；structure: A 原案（D1，2026-11-07）；accepted scope: issue #139 全部，新檔 `lib/monster-catalog.ts`；pending remedies: R1、R2。

### Scope Challenge A/C 發現

1. [CRITICAL] (confidence: 9/10) `lib/room/dungeon-room.ts:308` — `constructor(readonly room: RoomIO, private rng: () => number = Math.random, opts: RoomOptions = {})`：房間物件不知道自己的房間 code（`RoomIO` 只有 broadcast、storage 等，`lib/room/io.ts`）。規格的 `hash(roomCode, id)` 照寫做不出來。Reviewer: Claude。
2. [INFORMATIONAL] (confidence: 9/10) `lib/room/dungeon-room.ts:620` — `const pub = publicQuestion(this.bank, id, team.roomIndex, …)`：題目的公開資料每次廣播都重算，不是快取。只有輪到的那隊能改變 `defeats`，所以「這一題期間外觀不變」自然成立；揭曉用的 `justAnswered`（:1627）在判定前就取，顯示的是被打倒當下的樣子。不需要決定；實作時 `publicQuestion` 多收 `defeats` 和起點即可。
3. [INFORMATIONAL] (confidence: 9/10) `app/room/[code]/host/page.tsx:570` — `<Sprite kind={turn.monster.kind} hue={turn.monster.hue} …/>`：主持人頁也畫怪物小圖（規格寫「主持人頁只有文字」是錯的）。事實更正：凡是畫 `pub.monster` 的 `Sprite`（大螢幕、手機、主持人頁，經 `lib/turn-info.ts:48`）都帶 `accessory`。
4. [INFORMATIONAL] (confidence: 8/10) 舊編輯器 `app/bank-editor/page.tsx:88` 的 `clean(m)` 會把字串 monster 展開成物件。前端和 Worker 部署先後不定時，新舊版混搭的幾分鐘內編輯器會壞，但存檔會被 parseBank 擋下（物件 → 「題庫格式太舊」，或舊 Worker 不認得字串），不會蓋掉資料。遊戲頁：舊前端忽略新欄位、新前端缺 `accessory` 當沒配件。重新種子清單第 3 步「等兩邊都部署完」已處理。不需要決定。
5. [INFORMATIONAL] (confidence: 9/10) `app/bank-editor/page.tsx:472` 與 TODOS「題庫編輯器…名字和造型不能改」：舊編輯器不能改怪物名字，所以站長的主題題庫（`local-banks/`）裡的怪物一定是預設 9 隻之一。備份可以用一份「名字 → 圖鑑 id」對照表機械轉成新格式，不用手動重建。見 R2。

Scope Challenge 結果：scope accepted as-is（D1 選原案；R1、R2 已決定，見 Decision ledger）。

REALITY: premise-table pass 規格 7 個前提都有出處（BANK_FORMAT=2、unreadable 擋 putBank、6 種造型、BankMonster、DishFields、publicQuestion、hue-rotate），1 個錯（主持人頁只有文字）已更正，unverified=0 lib/bank-store.ts:176
REALITY: already-done pass origin/main 0e30ea9 之後沒有圖鑑或 BANK_FORMAT 相關提交 lib/bank-store.ts:44
REALITY: surface-check pass 用到的路由 `GET/PUT /api/bank` 存在，`Authorization: Bearer` 與 lib/bank-api.ts:38 相符 worker/index.ts:187
REALITY: binding-decisions pass 站長 D1–D6（2026-11-07）沿用；本次新增 D1–D3 已記錄，無推翻 docs/designs/monster-catalog.md:1
REALITY: numbers pass 檔案數 14 [estimated]、圖鑑筆數 6/23 [measured: data/question-bank.json 9 隻、sprite-kind 6 種]、工時 [estimated] lib/sprite-kind.ts:6
REALITY: deferred-asks pass issue #139 的需求全部在 PR1/PR2 驗收裡；表情變化、首領配件依 D5 不做 docs/designs/monster-catalog.md:1
REALITY: pr-count pass 兩個 PR（站長指定拆分）；沒有 .gstack/ship-policy.json，每多一個 PR 多一輪 /review→/ship→READY→controller 合併 lib/sprite-kind.ts:6

## Review Sections

### 1. Architecture

```
data/question-bank.json ── parseBank ──▶ Bank.rooms[i].monster = "slime-soft"（只存 id）
        │                                   │ monsterById（lib/monster-catalog.ts，client 也能 import）
        │                                   ▼
        │                 RoomTemplate.monsterId ─┐
        │                                         │ answerQuestion: correct-room-advance
        │                                         ▼
        │                 GameState.defeats[id] += 1   GameState.variantSeed（開局 rng，R1）
        │                                         │
        ▼                                         ▼
 dungeon-room.currentQuestion ── publicQuestion(bank, id, roomIndex, …, {defeats, variantSeed})
        │                           └─ variantOf(seed, m, n) → name=稱號+名字, hue=(hue+shift)%360, accessory
        ▼
 STATE.question.monster ──▶ screen / play / host 的 Sprite（怪物 canvas 套 hue-rotate，配件 canvas 不套）
 reveal.dish.monster = justAnswered.pub.monster（打倒當下的樣子）

BankStore.read():  format>3 → unreadable（唯讀）
                   format<3 → outdated（預設題庫＋存著的 version，可覆蓋）
                   format=3 → parseBank；壞了 → unreadable
```

**Design-twice（新模組 `lib/monster-catalog.ts`）：**
- 形狀 A（採用）：題庫只存 id，用到時 `monsterById` 查。介面小：`MONSTERS`、`monsterById`、`variantOf`。圖鑑只有一個擁有者。
- 形狀 B：`parseBank` 把 id 展開成整隻怪物物件存在 `Bank` 裡，序列化時再壓回 id。呼叫端少改幾處（dungeon-room 4 處、question-bank 2 處），但同一份怪物資料同時活在圖鑑和每個 Bank 物件裡，編輯器存檔要記得壓回 id，房間存檔的題庫副本也會帶整隻怪。
- 選 A：一個決定（怪物長怎樣）只在一處。

**紅旗檢查：**
- 8 Hand-synced list：`MONSTER_SPRITES`（`lib/sprite-kind.ts:6`）和 `MONSTERS` 的 sprite 要一一對應，PR2 加造型時兩邊都要加。修法：單元測試要求兩者是一對一（每個造型剛好一隻圖鑑怪），不一致就失敗。列為必要測試（不需要另外決定）。
- 2 Information leakage：稱號＋名字的組字只在 `publicQuestion` 做一次；`reveal.dish.monster` 沿用 `justAnswered.pub.monster`，旁白用 `pub.monster.name`，不各自組字。
- 其他 6 項：沒有發現。

發現：
- [INFORMATIONAL] (confidence: 8/10) `lib/room/dungeon-room.ts:701` — `phaseCard: { monster: { name: this.bank.boss.monster.name, sprite: …, hue: … } }`：首領的 phaseCard、boss-phase 旁白（:1350）、首領菜（:1476、:1662）都直接讀 `bank.boss.monster` 的欄位，改成 id 後這 4 處都要改查圖鑑。屬於規格範圍內的必要改動，列進 T3。
- [INFORMATIONAL] (confidence: 8/10) `lib/room/dungeon-room.ts:704` — `...(hasCuisine(this.bank) ? { cuisine: true as const } : {})`：圖鑑每隻都有菜，`cuisine` 永遠為真。保留欄位（舊前端靠它選字），`hasCuisine` 直接回傳 true 或刪掉改成常數；編輯器 `scoreName(hasCuisine(...))`（`app/bank-editor/page.tsx:463`）一併簡化。

Dispositions: 兩項都是規格內必要改動，排進實作任務；無新決定。

### 2. Code quality

- [INFORMATIONAL] (confidence: 9/10) `app/bank-editor/page.tsx:14` — `import { DIFFICULTIES, DISH_FIELDS, DISH_LIMITS, … hasCuisine …} from "@/lib/question-bank"`：`DISH_FIELDS`、`dishError`（:98）、`withoutEmptyDishes`（:88）、`DishFields`（:491、:511）在 PR1 後都沒有用途，要一起刪，不要留死碼。
- [INFORMATIONAL] (confidence: 8/10) `lib/question-bank.ts:335` — `bank.rooms.map((r) => ({ baseDifficulty: r.difficulty, reward: r.reward, ...(r.monster.dish ? { dish: r.monster.dish.name } : {}) }))`：RoomTemplate 建法要改成 `monsterId` ＋ 圖鑑菜名，跟 R1 的 `defeats` 計數共用這個 id。
- 邊界：圖鑑 id 一旦上線就只增不刪（刪了舊題庫會 parse 失敗變 unreadable）。寫進 `lib/monster-catalog.ts` 檔頭註解。
- 邊界：`legacyImageKeys` 對非物件、非字串一律略過，不丟錯（規格已寫）。
- 學到的坑（Prior learning applied: serve-gate-masks-host-check-tests，confidence 9/10，2026-11-07）：bank-store 新增 outdated 分支後，「format 4 仍拒絕」「format 3 壞掉仍 unreadable」兩個負向測試要各自刪掉對應判斷確認會失敗，避免被新分支提早擋下而假通過。

Dispositions: 全部是必要的清理或測試要求，排進實作任務；無新決定。

### 3. Tests

```
CODE PATHS                                              USER FLOWS
[+] lib/monster-catalog.ts                              [+] 題庫編輯器
  ├── [GAP] MONSTERS 筆數/boss 數/id 與 sprite 不重複      ├── [GAP] [→E2E] 選怪物→存檔→重新載入（改寫 bank-editor.spec 的菜測試）
  ├── [GAP] MONSTER_SPRITES ↔ MONSTERS 一對一              ├── [GAP] [→E2E] outdated：黃色提示、儲存可按
  ├── [GAP] 料理字數（DISH_LIMITS）                        └── [★★ TESTED] unreadable 唯讀 — e2e/bank-editor-readonly.spec.ts:5（保留）
  └── variantOf                                         [+] 遊戲
      ├── [GAP] n=0 → null；boss → null                   ├── [GAP] [→E2E] 同一隻第二次登場名牌有稱號
      ├── [GAP] 同 seed 同 n 結果相同                       └── [GAP] 大螢幕重新整理後配件不變（unit：persist/restore）
      ├── [GAP] 連續 n 配件不重複、hue = (hue+shift)%360
[+] lib/question-bank.ts parseBank / publicQuestion
  ├── [GAP] 新格式通過；物件 → 「題庫格式太舊」；未知 id；room 用首領/boss 用小怪
  └── [GAP] publicQuestion 帶 defeats：n=0 原名、n=1 稱號＋配件
[+] lib/bank-store.ts read/putBank
  ├── [GAP] format 1、2 → outdated＋存著的 version
  ├── [GAP] outdated putBank 成功、version+1、format 3；版本不對 → conflict
  ├── [GAP] 舊圖（legacyImageKeys）沒被新題庫用到 → 排刪除
  ├── [★★★ TESTED→要改] format 比較新 → unreadable（現有測試改成 format 4）
  └── [GAP] format 3 壞掉 → unreadable（刪判斷要會失敗）
[+] lib/game-state.ts / dungeon-room
  ├── [GAP] correct-room-advance 才加 defeats；答錯/逃跑/boss-hit/boss-kill 不加
  ├── [GAP] variantSeed 開局抽一次、存檔還原後相同
  └── [GAP] 舊存檔沒有 defeats/variantSeed → {} / 0
[+] lib/pixel-art.ts
  └── [GAP] 6 配件 × 每個小怪造型：配件落在畫布內

COVERAGE: 1/19 paths（全是新路徑）| GAPS: 18（3 E2E）
```

測試卡（每個新測試的註解要附 protects / fails_when / no_claim）：
- 圖鑑完整性：protects=23（PR1 為 6）筆、boss 數、id/sprite 唯一；fails_when=重複 sprite 或少一隻首領；no_claim=畫面上看得出來不同。
- 造型一對一：protects=每個 MONSTER_SPRITES 剛好一隻圖鑑怪；fails_when=PR2 只加造型或只加圖鑑；no_claim=料理圖存在（tsc 管）。
- variantOf：protects=n=0/boss 原樣、決定性、配件輪替、hue 公式；fails_when=n 起點錯一位或 mod 漏掉；no_claim=畫面渲染。
- parseBank：protects=四種拒絕訊息；fails_when=舊格式被接受或錯誤訊息不含「題庫格式太舊」；no_claim=編輯器怎麼顯示。
- bank-store outdated：protects=舊格式可覆蓋、新格式/壞資料不可；fails_when=format 判斷順序錯；no_claim=真的 Durable Object（記憶體 storage）。
- defeats：protects=只在打倒房間怪時加、跟存檔走；fails_when=答錯也加、還原後歸零；no_claim=多台裝置同時操作（DO 依序執行）。
- 配件位置：protects=配件不超出畫布；fails_when=錨點寫錯；no_claim=好不好看（PNG 確認）。
- e2e 稱號：protects=第二次登場名牌是「稱號＋名字」；fails_when=變化沒帶進 STATE；no_claim=配件畫得對（unit 管）。

要改的既有測試：`e2e/bank-editor.spec.ts` 的菜欄位測試改成選怪物；`lib/question-bank.test.ts` 的 dish 測試改成 id；`lib/bank-store.test.ts` 的「format 比較新」改用 4；提到 3 隻換色怪名字的測試與 e2e（`e2e/main-line.spec.ts` 等）讀過再改。
Tests to retire: dish 四格的部分填寫、字數、空白測試（題庫不再有菜欄位）。

### 4. Performance

`defeats` 最多 20 個 key；`variantOf` 每次廣播算一次 FNV（字串十幾個字）；`legacyImageKeys` 只在覆蓋舊題庫那一次走一遍題庫（幾百個節點）。圖鑑進 client bundle 約 23 筆文字，幾 KB。No issues found.

## Decision ledger

### R1: 小變化的起點從哪來（房間不知道自己的 code）
Finding: 1, CRITICAL, 9/10, lib/room/dungeon-room.ts:308, Claude
Plan baseline: 規格（站長原話）「用 `hash(roomCode, id)` 當起點輪替配件和換色」。
Runtime evidence: `DungeonRoom` 的建構子只拿到 `RoomIO`，沒有房間 code；worker 的 `Room`（partyserver）有 `this.name`，但沒傳進來。
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 起點來源 | `hash(roomCode, id)`，做不出來 | 開局時用房間的 `rng` 抽一個 32 位元 `variantSeed` 存進 `GameState`，起點 = `fnv1a(\`${variantSeed}:${id}\`)`；同一場遊戲決定性、跟著存檔；同一個房間 code 再開新局會換一組 | `RoomIO` 加 `code` 欄位，worker 傳 `this.name`，起點照規格 `fnv1a(\`${roomCode}:${id}\`)`；同一個房間 code 每局都一樣 |
| R2 主題題庫轉換 | pending | pending | pending |
Question D2:
D2 — 小變化的起點：房間取不到自己的 code，改用開局亂數，還是把 code 傳進房間？
Project/branch/task: feat/monster-catalog，issue #139 的小變化。
ELI10: 規格說「同一隻怪第幾次被打倒要戴哪個配件」用房間 code 算起點。但房間程式其實不知道自己的 code。可以改成開局時擲一次亂數存起來當起點（效果一樣：這場遊戲裡固定、重新整理不變），或是改 worker 把 code 傳進房間。
Stakes if we pick wrong: 選 B 時，同一個房間 code 連開幾局，配件順序每局都一樣，玩家會覺得重複；選 A 時規格的公式要改寫。
Recommendation: A because 不用改 worker 和房間介面，測試可以用固定亂數，且每局都新鮮。
Completeness: A=10/10, B=10/10
Header: 變化起點
Options:
A) 開局亂數起點 (recommended)
開局時用房間 rng 抽 variantSeed 存進 GameState（跟存檔走），起點 = fnv1a(`${variantSeed}:${id}`)。不動 worker。(human: ~1h / CC: ~5 min)
B) 傳房間 code 進來
RoomIO 加 code，worker/index.ts 傳 this.name，測試的假 RoomIO 都要補。起點照規格。同一個 code 每局一樣。(human: ~2h / CC: ~10 min)

State: approved
Actual answer: A) 開局亂數起點（D2，2026-11-07）
Accepted scope: `GameState` 加 `variantSeed: number`（開局時 `Math.floor(rng() * 2**32)`，跟存檔走；舊存檔沒有時用 0）；`variantOf(seed, m, n)` 的起點 = `fnv1a(\`${seed}:${m.id}\`)`，其餘公式照規格。不動 worker 和 `RoomIO`。測試用固定 rng。
History: none

### R2: 站長主題題庫怎麼搬到新格式
Finding: 5, INFORMATIONAL, 9/10, app/bank-editor/page.tsx:472, Claude
Plan baseline: D6「舊格式題庫不支援，要重建」；規格第 6 節第 6 步「用新編輯器重建：選怪物、貼回題目」。
Runtime evidence: 舊編輯器不能改怪物名字，主題題庫的怪物只會是預設 9 隻之一；題目部分（pools、boss.phases）新舊格式相同。
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 主題題庫轉換 | 手動重建（貼回每一題） | 重新種子清單加一段本機一次性指令（不進產品程式）：用「名字 → id」表把備份的 rooms[].monster、boss.monster 換成 id（暴躁幽靈→ghost-shy、熔岩史萊姆王→slime-soft、冰霜愛哭鬼→ghost-cry），再用 PUT 存回；產品仍不讀舊格式（D6 不變） | 照規格手動重建 |
| R1 起點 | approved A（D2） | 不變 | 不變 |
Question D3:
D3 — 站長的主題題庫要手動重建，還是在上線清單加一段一次性轉換指令？
Project/branch/task: feat/monster-catalog，issue #139 的重新種子清單。
ELI10: 新格式只存怪物 id。你的主題題庫題目不用改，只有每關的怪物欄位要從「整隻怪物」換成 id。因為舊編輯器本來就不能改怪物名字，所以可以用一張對照表機械換掉，不用一題一題貼。產品照樣不支援舊格式（D6 不變），這只是清單裡的一段本機指令。
Stakes if we pick wrong: 手動重建要把幾十題重新貼進編輯器，容易漏題或貼錯答案，也趕不上活動前的時間。
Recommendation: A because 幾行指令就能保住全部題目，不碰產品程式。
Completeness: A=9/10, B=6/10
Header: 主題題庫
Options:
A) 加一次性轉換指令 (recommended)
清單第 6 步改成：用 node 一行把備份裡的怪物換成 id（3 隻換色怪對到原版），再 PUT 回正式站。不進產品程式，D6 不變。(human: ~30 min / CC: ~5 min)
B) 照規格手動重建
在新編輯器選怪物、一題一題貼回題目。不寫任何指令。(human: ~2h，看題數 / CC: 不適用)

State: approved
Actual answer: A) 加一次性轉換指令（D3，2026-11-07）
Accepted scope: 重新種子清單第 6 步改成本機一次性轉換：讀第 1 步的備份，用「名字 → id」表（軟趴趴史萊姆→slime-soft、害羞幽靈→ghost-shy、迷路史萊姆→slime-soft、愛哭幽靈→ghost-cry、守門史萊姆王→slime-soft、暴躁幽靈→ghost-shy、熔岩史萊姆王→slime-soft、冰霜愛哭鬼→ghost-cry、深淵小黑龍→dragon）換掉 rooms[].monster 與 boss.monster，對不到的名字就停下並印出來；輸出到 `local-banks/`，再 PUT 回正式站。指令寫在 docs/question-bank.md（雙語）的舊格式救援段落與 PR1 READY 附的清單，不進產品程式；產品照 D6 不讀舊格式。
History: none

## Outside Voice（Codex，gpt-6-luna，2026-11-07）

- **High** — `lib/room/snapshot.ts:124`、`lib/room/dungeon-room.ts:554`：PR1 之後的房間存檔裡題庫副本是新格式，回滾到 v0.39 時舊 `parseBank` 讀不懂，進行中的房間會被丟掉。規格只寫了升級時舊房間被丟。
  - Claude 查證：屬實（`parseSavedBank` 失敗回 null）。房間本來就是 24 小時的暫存，活動當天不部署；這是事實更正，不改行為：Rollout 第 3 點補「回滾會讓進行中的房間存檔失效，不要在有人玩的時候回滾」。（confidence 9/10）
- **Medium** — `app/bank-editor/page.tsx:159`：前端和 Worker 部署先後不定，新舊混搭時編輯器拿到對方格式的題庫。
  - Claude 查證：同 Scope 發現 4，存檔會被 parseBank 擋，不會蓋掉資料；但新編輯器可以在拿到舊格式（monster 是物件）時直接顯示「前後端版本不一致」並停用儲存，舊編輯器管不到。見 R3。（confidence 8/10）

### R3: 新編輯器遇到舊 Worker 回傳的舊格式題庫
Finding: Outside Voice 2, INFORMATIONAL, 8/10, app/bank-editor/page.tsx:159, Codex（Claude 查證）
Plan baseline: 規格第 6 節第 3 步「等兩邊都部署完」再重新種子；編輯器不檢查回傳格式。
Runtime evidence: `page.tsx:177` 直接 `const versioned: { bank: Bank; … } = await res.json()`，沒有驗證形狀。
Comparison grid:
| Choice | Current | A | B | C | D |
|---|---|---|---|---|---|
| R3 編輯器檢查回傳格式 | 不檢查 | 載入時若任何 room/boss 的 monster 不是字串，切唯讀並顯示紅字「伺服器還是舊版，等部署完成再重新載入」（約 6 行＋1 個 e2e 斷言） | 不檢查，靠清單第 3 步 | 先查 Vercel/Workers Builds 實際部署間隔再決定（不改程式） | 這項延後，不在本 PR |
| R1 起點 | approved A（D2） | 不變 | 不變 | 不變 | 不變 |
| R2 主題題庫轉換 | approved A（D3） | 不變 | 不變 | 不變 | 不變 |
Question D4:
D4 — 部署空窗期：新編輯器拿到舊格式題庫時，要不要直接擋下並提示？
Project/branch/task: feat/monster-catalog，PR1 上線那幾分鐘。
ELI10: 合併後網站（Vercel）和伺服器（Cloudflare）各自部署，誰先好不一定。如果網站先好、伺服器還是舊版，新編輯器會拿到舊格式的題庫，畫面會怪怪的。資料不會壞（存檔會被擋），但站長可能以為壞了。加幾行檢查就能直接顯示「伺服器還是舊版，等一下再載入」。
Stakes if we pick wrong: 不加的話，站長在空窗期打開編輯器會看到壞掉的選單，可能誤以為上線失敗而回滾。
Recommendation: A because 幾行程式就把一個會嚇到人的空窗期變成清楚的提示。
Completeness: A=9/10, B=7/10, C=7/10, D=6/10
Header: 部署空窗
Options:
A) 加格式檢查 (recommended)
載入時 monster 不是字串就唯讀＋紅字提示「伺服器還是舊版，等部署完成再重新載入」。約 6 行＋e2e 一個斷言。(human: ~30 min / CC: ~5 min)
B) 不檢查
維持現狀，靠清單「等兩邊部署完」。空窗期編輯器會顯示壞掉的選單，但存檔被擋，不會壞資料。
C) 先查部署間隔
先看 Vercel 和 Workers Builds 平常差幾分鐘再決定，這次不改程式。
D) 延後
不放在 PR1，之後需要再說。

State: approved
Actual answer: A) 加格式檢查（D4，2026-11-07）
Accepted scope: 編輯器載入題庫後，若任何 `rooms[i].monster` 或 `boss.monster` 不是字串，切唯讀（停用儲存）並顯示紅字「伺服器還是舊版，等部署完成再重新載入」；e2e 加一個斷言（route-mock GET 回物件 monster）。
History: none

### R4: 23 隻名單（/plan-design-review，2026-11-07）

PNG：`~/.gstack/projects/critical-answer/designs/monster-catalog/roster.png`、`v2/roster.png`（本機，不進 git）。

State: approved
Actual answer: 站長原話「拿掉迷路史萊姆跟守門史萊姆王 不要有守門王」；補位從 4 隻候選（南瓜頭、刺刺仙人掌、迷你雪人、棉花雲）選「A 南瓜頭、B 刺刺仙人掌」。
Accepted scope: 小怪 20 隻＝現有 3 隻（slime-soft、ghost-shy、ghost-cry）＋新畫 17 隻（原草圖 15 隻＋pumpkin、cactus）；首領 3 隻不變。slime-lost、slime-king 的造型留在程式（地圖裝飾還在用），只是不進圖鑑；R2 的名字 → id 表改成三隻史萊姆類都對到 slime-soft。其餘名字、菜名照 roster.png。
History: v1 名單 23 隻（含 slime-lost、slime-king）被改。

### R5: 小變化樣式（/plan-design-review，2026-11-07）

PNG：`~/.gstack/projects/critical-answer/designs/monster-catalog/v2/accessories.png`（本機，不進 git）。

State: approved
Actual answer: 「照這樣做，配件放大 (recommended)」
Accepted scope: 6 配件（王冠、派對帽、小花、頭巾、蝴蝶結、海盜帽）＋對應稱號（戴王冠的、慶生中的、戀愛中的、熱血的、打扮過的、海盜）＋換色 0°/90°/180°/300°；名牌顏色見 R6；配件不套 hue-rotate；正式版配件畫成 8–11 格寬（PNG 上是 4–7 格）。
History: none

### R6: 有稱號的名牌顏色（/plan-design-review Pass 5，2026-11-07）

問題：大螢幕首領名牌已經是紅字（`app/room/[code]/screen/page.tsx:391`，`#b02a3a`）；accessories.png 有稱號的名牌畫成紅字（`--wrong` `#c94848`），後排會以為首領出來了。

State: approved
Actual answer: 「照舊深紫字 (recommended)」
Accepted scope: 有稱號的小怪名牌照舊 `--ink` 深紫字，跟沒稱號時一樣；紅字只留給首領。不加 `title` 欄位，名牌不拆字。
History: R5 的 PNG 畫成紅字，本題改掉。

Approval readiness: PASS — R1（D2=A）、R2（D3=A）、R3（D4=A）、R4、R5、R6 各有自己的回答；範圍 D1=A（原案）。站長 D1–D6（2026-11-07）沿用不再問。

## TODOS.md

本項完成後：P1「題庫編輯器新增怪物：打名字，AI 產生怪物和料理的像素圖」改成「被圖鑑取代」移到 Completed；「BANK_FORMAT 沒升」由 BANK_FORMAT 3 解決，移到 Completed。沒有新的 TODO 提案。

## NOT in scope

- AI 產生怪物或料理圖：站長 2026-11-07 改成固定圖鑑。
- 產品讀取或轉換舊格式題庫：D6；主題題庫用清單裡的一次性本機指令轉（R2）。
- 首領配件與換色：D5。
- 表情變化：23 種造型逐一畫成本太高。
- 回滾時保住進行中的房間：房間是 24 小時暫存，不在有人玩的時候回滾即可（Outside Voice 1）。

## What already exists

- `BankStore` 的 format／unreadable 機制（`lib/bank-store.ts:148`）：沿用，只加 `outdated` 一個分支。
- 「舊存檔缺欄位補預設值」先例（`Team.dishes`，`lib/game-state.ts:136`）：`defeats`、`variantSeed` 照做，不升 `SCHEMA_VERSION`。
- `Sprite` 的 `hue`（`components/pixel.tsx:144`）：怪物換色沿用；配件另一個 canvas 不套濾鏡。
- `DISH_SPRITE: Record<MonsterSprite, SpriteKind>`（`lib/sprite-kind.ts:10`）：PR2 漏畫料理圖時 tsc 失敗，沿用。
- 編輯器唯讀提示（`app/bank-editor/page.tsx:353`、`e2e/bank-editor-readonly.spec.ts`）：outdated 黃色提示與 R3 紅字沿用同一處。
- 房間的 `rng`（`lib/room/dungeon-room.ts:310`）：R1 的 `variantSeed` 用它抽，測試可注入固定值。

## Failure modes

| 新路徑 | 會怎麼壞 | 有測試？ | 有處理？ | 使用者看得到？ |
|---|---|---|---|---|
| bank-store outdated | format 判斷順序錯，把 format 4 當 outdated 覆蓋掉新版題庫 | 計畫中（format 4 仍拒絕） | 是 | 否（會被測試擋） |
| 重新種子 | 部署沒完成就存檔 | 清單第 3 步 | R3：新編輯器遇舊 Worker 擋下 | 是，紅字 |
| 小變化 | 舊存檔沒有 defeats/variantSeed | 計畫中 | 是（{}／0） | 否 |
| 配件 | 錨點寫錯超出畫布 | 計畫中 | 是（測試） | 否 |
| 房間存檔 | 升級或回滾時題庫副本讀不懂 | 既有 parseSavedBank 測試 | 是（丟掉存檔，房間重開） | 是，房間重來；不在活動中部署 |
| 主題題庫轉換 | 名字對不到 id | 指令本身停下並列出 | 是 | 是，終端機訊息 |

Critical gaps: 0。

## Worktree parallelization

一條線依序做：圖鑑 → 題庫格式／bank-store → game-state／dungeon-room／protocol → 三個遊戲頁的配件 → 編輯器 → 文件。後面都依賴圖鑑和題庫格式。Sequential implementation, no parallelization opportunity.（PR2 的造型和料理圖要等 PR1 合併、名單 PNG 確認後才開始。）

## Implementation Tasks

- [ ] **T1 (P1, human: ~2h / CC: ~15min)** — monster-catalog — 新檔 `lib/monster-catalog.ts`：4 筆圖鑑（slime-lost、slime-king 造型留著，不進圖鑑）、`BankDish`/`DISH_LIMITS` 搬來、`ACCESSORIES`/`TITLE`/`HUE_SHIFTS`、`fnv1a`、`variantOf(seed, m, n)`；檔頭註明 id 只增不刪
  - Surfaced by: 規格第 1、3 節；R1（D2）；Code quality「id 只增不刪」；Architecture 紅旗 8
  - Files: lib/monster-catalog.ts, lib/monster-catalog.test.ts
  - Verify: `npx vitest run lib/monster-catalog`
- [ ] **T2 (P1, human: ~3h / CC: ~20min)** — question-bank／bank-store — monster 改 id、四種錯誤訊息、`BANK_FORMAT = 3`、`outdated`、`legacyImageKeys`、預設題庫改 id
  - Surfaced by: 規格第 2、5 節；Code quality 負向測試要刪判斷驗證
  - Files: lib/question-bank.ts, lib/bank-store.ts, data/question-bank.json, lib/question-bank.test.ts, lib/bank-store.test.ts
  - Verify: `npx vitest run lib/question-bank lib/bank-store`
- [ ] **T3 (P1, human: ~3h / CC: ~20min)** — game-state／dungeon-room／protocol — `RoomTemplate.monsterId`、`GameState.defeats`、`variantSeed`、`publicQuestion` 帶變化、首領 4 處改查圖鑑、`cuisine` 常數化
  - Surfaced by: 規格第 3 節；R1；Architecture 發現（dungeon-room.ts:701、:704）
  - Files: lib/game-state.ts, lib/room/dungeon-room.ts, lib/protocol.ts, lib/question-bank.ts, 對應測試
  - Verify: `npx vitest run`
- [ ] **T4 (P1, human: ~3h / CC: ~20min)** — 畫面 — `HEAD_ANCHOR`、6 個配件 sprite、`Sprite` 的 `accessory`；大螢幕、手機、主持人頁都帶（配件樣子要先過 /plan-design-review 的 PNG）
  - Surfaced by: 規格第 3 節；Scope 發現 3（主持人頁）
  - Files: lib/pixel-art.ts, components/pixel.tsx, lib/turn-info.ts, app/room/[code]/screen/page.tsx, play/page.tsx, host/page.tsx, components/cooking.tsx, lib/pixel-art.test.ts
  - Verify: `npx vitest run lib/pixel-art`；e2e 在 CI
- [ ] **T5 (P1, human: ~2h / CC: ~15min)** — bank-editor — 怪物選單、刪 DishFields/dishError/withoutEmptyDishes/DISH_FIELDS、黃色 outdated 提示、R3 紅字擋舊 Worker
  - Surfaced by: 規格第 4 節；Code quality 死碼；R3（D4）
  - Files: app/bank-editor/page.tsx, e2e/bank-editor.spec.ts, e2e/bank-editor-readonly.spec.ts
  - Verify: tsc＋lint；e2e 在 CI
- [ ] **T6 (P1, human: ~2h / CC: ~15min)** — 文件 — question-bank 雙語（圖鑑、格式 3、outdated、主題題庫一次性轉換指令 R2）、hosting 雙語名單、DESIGN.md 配件、monster-cuisine 指向本文件、scoring 文件名單、TODOS 移項；重新種子清單附在 READY
  - Surfaced by: 規格第 6 節；R2（D3）；Outside Voice 1（回滾說明）
  - Files: docs/question-bank.md, docs/question-bank.en.md, docs/hosting.md, docs/hosting.en.md, DESIGN.md, docs/designs/monster-cuisine.md, docs/designs/scoring-and-score-pools.md, TODOS.md
  - Verify: `npm run check:docs`
- [x] **T7 (P2, human: ~2 天 / CC: ~1–1.5 天)** — PR2 — 17 小怪＋2 首領造型、19 料理圖、圖鑑補到 23 筆、預設題庫 8 房 8 隻不同（名單 PNG 確認後）
  - Surfaced by: 規格 PR2 驗收
  - Files: lib/pixel-art.ts, lib/sprite-kind.ts, lib/monster-catalog.ts, data/question-bank.json
  - Verify: `npx vitest run`、tsc

## Unresolved decisions

None.

## Completion summary

- Step 0: Scope Challenge — scope accepted as-is
- Reality rows: 7/7 applicable rows emitted, 0 unverified premises
- Architecture Review: 2 issues found
- Code Quality Review: 2 issues found
- Test Review: diagram produced, 18 gaps identified
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex (gpt-6-luna), completed, 2 findings（1 事實更正、1 → D4）
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 1/3（D2 選 10/10；D3、D4 選的是最高分 9/10 的選項）

## Design Review Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | DESIGN.md 有；UI：編輯器選單、大螢幕/手機怪物 |
  | Step 0               | 7/10；重點：名單、配件樣子、名牌             |
  | Pass 1  (Info Arch)  | 9/10 → 9/10（選單＋小圖＋唯讀菜名已寫清楚） |
  | Pass 2  (States)     | 9/10 → 9/10（unreadable/outdated/舊 Worker） |
  | Pass 3  (Journey)    | 8/10 → 8/10（第一次原樣、重複登場有稱號）    |
  | Pass 4  (AI Slop)    | 9/10 → 9/10（沿用像素風元件，沒有新版型）    |
  | Pass 5  (Design Sys) | 7/10 → 9/10（R6：稱號名牌不用紅字）          |
  | Pass 6  (Responsive) | 8/10 → 8/10（名牌照舊 22px；窄格照舊省略號） |
  | Pass 7  (Decisions)  | 3 resolved（R4–R6），0 deferred              |
  +--------------------------------------------------------------------+
  | NOT in scope         | written（沿用 eng review）                  |
  | What already exists  | written（沿用 eng review）                  |
  | TODOS.md updates     | 0 items proposed                            |
  | Approved Mockups     | 3 generated, 2 approved（v2）               |
  | Decisions made       | 3 added to plan                             |
  | Decisions deferred   | 0                                           |
  | Overall design score | 7/10 → 8/10                                 |
  +====================================================================+
```

- Pass 4 litmus：沒有卡片格、沒有新版型；怪物圖是畫面主角（YES）；只用既有 `Nameplate`、`Sprite`、`Panel`。
- Pass 6：名牌最長「打扮過的尖叫曼德拉草」10 字 × 22px，大螢幕 1920 寬放得下；地圖格子的 14px 名牌照舊用省略號。手機只畫小圖，不加文字。

Unresolved Decisions: none

## Approved Mockups

| Screen/Section | Mockup Path | Direction | Notes |
|----------------|-------------|-----------|-------|
| 23 隻名單 | `~/.gstack/projects/critical-answer/designs/monster-catalog/v2/roster.png`（本機） | 小怪 18＋候選 4、首領 3 | 補位選南瓜頭、刺刺仙人掌（R4）；新怪物是草圖，PR2 重畫 |
| 小變化 | `~/.gstack/projects/critical-answer/designs/monster-catalog/v2/accessories.png`（本機） | 6 配件 × 3 小怪＋換色＋稱號 | 配件放大到 8–11 格寬（R5）；名牌不用紅字（R6） |

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex, `/plan-eng-review` outside voice | Independent 2nd opinion | 1 | completed | 2 findings: 1 事實更正（回滾）、1 → D4 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN | 22 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAN | score: 7/10 → 8/10, 3 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex (gpt-6-luna), plan-review phase, completed, 2 findings（回滾丟房間、部署空窗期的編輯器），都已處理。設計審查沒有跑外部意見。
- **CROSS-MODEL:** Claude 和 Codex 都指出部署空窗期的編輯器問題；Codex 多找到回滾會丟進行中的房間，Claude 查證屬實，改成 Rollout 說明。
- **VERDICT:** ENG + DESIGN 完成 — ready to implement。eng 的 issues_open 指已排進 T1–T7 的測試和必要改動，0 critical gaps。

NO UNRESOLVED DECISIONS
