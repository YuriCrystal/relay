# Relay · 自架短網址系統

[English](README.md) · **繁體中文**

[![CI](https://github.com/YuriCrystal/relay/actions/workflows/ci.yml/badge.svg)](https://github.com/YuriCrystal/relay/actions/workflows/ci.yml)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YuriCrystal/relay)

一套你完全擁有的短網址系統，跑在 Cloudflare 邊緣節點。
**單一 Worker** 同時是轉址引擎與後台 API，資料存 **D1**，後台是**單檔 `index.html`**（零建置、零外部依賴）。

直接用瀏覽器打開 `index.html` 就能玩 —— 預設為 **DEMO 模式**（假資料、可新增/編輯/看數據），照下面步驟約 10 分鐘上線真機。

> 核心理念：短網址不只是「把網址變短」，而是一個**你掌控的中繼站**。每一條連結都先經過你的站再轉出去，所以你能**追蹤成效、隨時改去向、累積再行銷受眾**。

---

## 為什麼用 Relay？

短網址服務到處都有，為什麼要自己架一個？因為**用免費的短網址服務，你其實是拿「自己的流量資料」在付費**——而且想要的功能常常鎖在付費牆後面。Relay 把這條中繼站收回你自己手上：

**改目的地，不用換網址**
活動換檔、落地頁搬家、合作下架——後台隨時改連結指向哪，已經貼出去、印出去的短網址完全不用動。

**看得出「哪個管道」真的帶來點擊**
同一條連結加尾巴分流：`/spring/ig`、`/spring/threads`、`/spring/edm` 各自計數。哪個平台、哪個 KOL 有效，數字攤開來看，不用再猜。

**還看得出「哪個管道」真的*轉換***
點擊只是一半。用**無 cookie** 的 `/track` 把註冊／成交回報回來，後台就顯示每個 `/suffix` 的轉換數與轉換率——看的是哪個管道帶來*成效*，不只是流量。零 cookie、無跨站身分，這正是 cookie 型工具做不到的隱私式做法。

**點過的人，變成你的再行銷受眾**
連結可掛 FB Pixel / GA4 / GTM——訪客在進站「之前」就先寫進你的再行銷名單。每一次點擊都是一個受眾觸點，而不是白白流掉。

**A/B 測落地頁，還能依裝置 / 國家導流**
依權重分流看哪一版轉換好；或把流量**依裝置**（iOS / Android）、**依國家**（`request.cf.country`）導去各自的目的地——一條連結，每種受眾看到對的落地頁。

**資料 100% 在你手上**
連結、點擊、受眾全進你自己的 Cloudflare D1。沒有第三方讀你的流量、沒有人哪天把功能搬進付費牆、不會因為服務收掉就連結全死。

**免費、無上限、你的網域**
跑在你自己的 Cloudflare 免費額度（每天 10 萬次轉址綽綽有餘），連結數沒有上限，還能掛自己的短網域（`go.yourbrand.com`）。

### 適合誰
- 多平台 / 多帳號經營的創作者、行銷、小團隊——想搞清楚「注意力和成效從哪來」
- 重視資料自主、不想被 SaaS 綁定、或哪天被漲價的人
- 想要一個**自己完全擁有**、可改可擴充的短網址基礎建設

### 不適合誰（講白）
- 只是偶爾縮一條網址、不在乎數據——用 Bitly 那類現成服務更省事
- 完全不想碰終端機——Relay 要你跑幾行 `wrangler` 指令（約 10 分鐘）才能上線

---

## 功能

- **短網址轉址** — 邊緣節點轉址，全球低延遲
- **改目的地不換網址** — 連結貼出去後，後台仍可隨時改它指向哪
- **A/B 加權分流** — 同一條連結依權重隨機分到不同版本
- **裝置 & 地區導流** — iOS / Android 與各國家（`request.cf`）流量導向不同目的地
- **`/suffix` 來源追蹤** — 同連結加尾巴（如 `/spring/ig`）分開計數，看哪個管道有效
- **行銷像素中介頁** — FB Pixel / GA4 / GTM：點過的人在進站前先寫進你的再行銷名單
- **密碼保護**、**到期時間**、**301 / 302**
- **UTM 產生器**、**QR Code**
- **數據分析** — 裝置 / OS / 來源 / 國家 / 時段 / suffix / A-B 變體
- **無連結數上限、自訂網域、資料 100% 在你自己手上**
- **無 cookie 轉換追蹤** — 用 `/track` 回報把註冊/成交歸因到連結與渠道，零 cookie
- **不重複訪客** — 總點擊之外再算「每日不重複」數（隱私式雜湊，IP / UA 不落地）
- **CSV / JSON 匯出** — 隨時把原始點擊資料下載帶走
- **選用：邊緣快取 & 自動清理** — KV 快取轉址抗規模；Cron 定期刪舊點擊

---

## 檔案

```
relay/
├─ worker.js       轉址引擎 + 後台 API（部署到 Cloudflare Workers）
├─ schema.sql      D1 資料表
├─ wrangler.toml   Worker 設定（已進版控；D1 自動建立、機密不放這）
├─ index.html      單檔後台（可丟 Cloudflare Pages，或本機直接開）
└─ README.md
```

---

## 部署

**一鍵：** 按上面的 **Deploy to Cloudflare** 按鈕——它會 fork repo、自動建 D1（有開的話連 KV）、部署。再跑下面兩行載入 schema、設 `ADMIN_TOKEN` 就完成。

**或一步步來（約 10 分鐘）：**

### 0. 前置
```bash
npm i -g wrangler
wrangler login
```

### 1. 建立 D1 並匯入 schema
```bash
wrangler d1 create relay
# 把回傳的 database_id 貼進 wrangler.toml（解開 database_id 那行）

wrangler d1 execute relay --remote --file=./schema.sql        # 雲端
# wrangler d1 execute relay --local  --file=./schema.sql       # 本機測試用
```

### 2. 設定後台金鑰
```bash
wrangler secret put ADMIN_TOKEN
# 輸入一組夠長的隨機字串，這就是後台登入金鑰
```

### 3. 部署 Worker
```bash
wrangler deploy
# 完成後得到網址，例如 https://relay.<你的子網域>.workers.dev
```

### 4. 打開後台連線
1. 用瀏覽器開 `index.html`（或把它丟到 Cloudflare Pages）。
2. 進左側「設定」，填：
   - **Worker API 位址**：上一步得到的網址
   - **後台金鑰**：步驟 2 設的 `ADMIN_TOKEN`
3. 按「測試連線」顯示成功即完成。金鑰只存在你的瀏覽器 localStorage。

---

## 自訂短網域（選填）

1. 在 Cloudflare 加入你的網域（例如 `relay.to`）。
2. 解開 `wrangler.toml` 最後的 `[[routes]]` 區塊，填上 `pattern`。
3. `wrangler deploy`。之後短網址就是 `https://relay.to/spring`。

---

## API（皆需 `Authorization: Bearer <ADMIN_TOKEN>`）

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/overview` | 總覽數字 + 14 天趨勢 + 熱門連結 |
| GET | `/api/links` | 連結列表（含點擊數）|
| POST | `/api/links` | 新增連結 |
| GET | `/api/links/:id` | 單一連結 |
| PATCH | `/api/links/:id` | 更新 |
| DELETE | `/api/links/:id` | 刪除（連同點擊紀錄）|
| GET | `/api/stats/:id?days=30` | 趨勢 + 裝置/OS/國家/來源/suffix/變體/時段 |
| GET | `/api/export?format=csv\|json&id=&days=` | 匯出點擊（CSV 或 JSON；可選 `id` / `days` 篩選）|

**公開轉址**：`GET /:slug` 或 `GET /:slug/:suffix`（suffix 用來追來源，例如 `/spring/ig`）。

**轉換回報**（公開、免 Bearer）：`POST /track` 或 `GET /track?slug=…`——回報某個 slug / suffix 的轉換（見下方「轉換追蹤（無 cookie）」段）。可選用 `CONVERSION_TOKEN` 加驗。

---

## 上線前提醒

1. **目的地網址**：建立／更新連結時已強制只收 `http(s)`，從源頭擋掉 `javascript:`／`data:` 等可被濫用的 scheme。
2. **防濫用**：目的地網域黑名單已內建——在 `wrangler.toml` 設 `BLOCKLIST = "a.com,b.com"` 即可擋掉指定網域（含子網域），零金鑰。要再強，設 `SAFEBROWSING_KEY`（`wrangler secret put`）就會在建立連結時用 Google Safe Browsing 查惡意網址；不設＝不啟用，照樣能跑。
3. **時區**：後台統計（今日點擊／日趨勢／時段熱度）依 `wrangler.toml` 的 `TZ_OFFSET` 計算，預設 `+8`（台灣）。在其他地區記得改成你的時區。

> QR 由後台**內嵌的 qrcode-generator（MIT）在瀏覽器本地產生**，不打任何第三方端點——你的連結目標不會外流，也不依賴外部服務的存活。

---

## 安全設計筆記

- 後台 API 全程需 Bearer token；token 用 `wrangler secret` 存，不進版控。
- 連結密碼以 `sha256(slug + ':' + 密碼)` 雜湊存放，不存明碼。
- 所有 D1 查詢都用 prepared statement 綁參數，避免 SQL injection。
- 中介頁的目的地網址以 `JSON.stringify` / 屬性跳脫安全嵌入，避免 XSS。
- 目的地網址只放行 `http`／`https`，從源頭擋掉 `javascript:`／`data:` 等危險 scheme。
- QR 在瀏覽器本地產生（內嵌 qrcode-generator），不打外部端點。
- `robots.txt` 預設 `Disallow: /`，短網址不被搜尋引擎收錄。

---

## 轉換追蹤（無 cookie）

Relay 把轉換歸因到連結，**完全不用任何 cookie**。當有人在你的落地頁完成動作（註冊、購買…），由你的網站回報——伺服器對伺服器、聚合、無跨站身分：

```bash
curl -X POST https://<your-relay>/track \
  -H 'content-type: application/json' \
  -d '{"slug":"spring","suffix":"ig","event":"signup"}'
```

欄位：`slug`（必填）、`suffix`（渠道/KOL 標籤）、`variant`、`event`（如 `signup`/`purchase`）、`value`（選填數值）。也支援 `GET /track?slug=…` 帶 query（給 `navigator.sendBeacon` / 像素用）。

後台接著顯示**轉換數、轉換率、以及「點擊→轉換」逐渠道表**——讓你看到哪個 `/suffix` 真的會*轉換*，不只是哪個有流量。這正是 cookie 型工具做不到的隱私式做法。

**防濫報（選用）：** 設 `CONVERSION_TOKEN` 機密（`wrangler secret put CONVERSION_TOKEN`），回報時帶 `X-Conversion-Token` 標頭（或 `token` 欄位）——伺服器端回報建議開。不設＝開放 beacon（自用/可信環境沒問題）。

---

## 隱私

Relay 預設就走隱私友善——它追蹤的是「連結點擊」，不是「人」：

- **無 cookie、無追蹤腳本。** 點擊在轉址當下於伺服器端計數，訪客瀏覽器裡什麼都不跑，也不設任何跨站識別碼。
- **不存 IP。** 只留一個粗略的國家代碼（來自 Cloudflare 邊緣），絕不存原始 IP。
- **不存原始 User-Agent。** 只留抽取後的 裝置 / OS / 瀏覽器；完整 UA 字串（指紋來源）直接丟掉。
- **referrer 只留網域。** 只存來源主機（如 `google.com`），絕不存含路徑／查詢字串的完整網址。
- **排除機器人。** FB／Slack／Discord／Telegram 等連結預覽爬蟲照常被轉址（預覽正常），但不計入點擊、也不觸發像素——所以你的數字是真人點擊。
- **尊重退出（選用）。** 設 `RESPECT_DNT = "1"`，送出 `DNT`／`Sec-GPC` 的訪客會被轉址但不被記錄。
- **資料在你自己的伺服器。** 一切都在你自己的 Cloudflare D1，別人讀不到。

> 行銷像素（FB／GA4／GTM）是逐連結選用——只有你掛了像素的連結才會載入，而且只對真人訪客。

---

## 規模化 / 升級（選用）

- **邊緣快取** — 建一個 KV namespace 綁成 `LINKS_KV`（見 `wrangler.toml`），轉址會先讀 KV，降低 D1 讀取與延遲。改連結後仍會在 `CACHE_TTL`（預設 60 秒）內生效。沒綁＝永遠讀 D1（即時，現有行為）。
- **自動清理** — 設 `RETENTION_DAYS` 並啟用 `[triggers]` 排程，每天自動刪掉超過 N 天的點擊。不設＝永久保留。

> **從舊版升級？** 對你的 D1 跑一次下面這行，再重跑一次 `schema.sql` 來補上新的 `conversions` 表（它用 `CREATE TABLE IF NOT EXISTS`，不會動到既有資料表）：
> ```sql
> ALTER TABLE clicks ADD COLUMN visitor_hash TEXT DEFAULT '';
> ```
> 全新安裝的 `schema.sql` 已內含。沒加這欄的話，記點擊會靜默失敗直到補上。

---

## 費用

**完全自架，跑在你自己的 Cloudflare 帳號**——沒有中央伺服器，作者不替任何人付費。對絕大多數人就是 **$0**：

- Workers 免費層：每天 10 萬次請求
- D1 免費層：5GB 儲存、每天數百萬列讀取
- Pages（放後台 `index.html`）：免費

只有超過免費額度才付費，而且付的是**你自己**的 Cloudflare 帳單，跟作者與其他使用者完全無關。fork 下去、填自己的 `database_id` 與 `ADMIN_TOKEN`，這套就 100% 是你的。

---

## 開發

純 `node:test` 單元測試涵蓋轉址／隱私／解析等核心函式，零相依：

```bash
node --test
```

CI 會在每次 push / PR 自動跑（`.github/workflows/ci.yml`）。

---

## 授權 License

[MIT](./LICENSE) © 2026

自由使用、修改、散布、商用，只要保留版權聲明即可。歡迎 fork、star、提 issue。
