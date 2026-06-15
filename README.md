# Relay · 自架短網址系統

一套你完全擁有的短網址系統，跑在 Cloudflare 邊緣節點。
**單一 Worker** 同時是轉址引擎與後台 API，資料存 **D1**，後台是**單檔 `index.html`**（零建置、零外部依賴）。

直接用瀏覽器打開 `index.html` 就能玩 —— 預設為 **DEMO 模式**（假資料、可新增/編輯/看數據），照下面步驟約 10 分鐘上線真機。

> 核心理念：短網址不只是「把網址變短」，而是一個**你掌控的中繼站**。每一條連結都先經過你的站再轉出去，所以你能**追蹤成效、隨時改去向、累積再行銷受眾**。

---

## 功能

- **短網址轉址** — 邊緣節點轉址，全球低延遲
- **改目的地不換網址** — 連結貼出去後，後台仍可隨時改它指向哪
- **A/B 加權分流** — 同一條連結依權重隨機分到不同版本
- **裝置導流** — iOS / Android / 其他各自導向不同目的地
- **`/suffix` 來源追蹤** — 同連結加尾巴（如 `/spring/ig`）分開計數，看哪個管道有效
- **行銷像素中介頁** — FB Pixel / GA4 / GTM：點過的人在進站前先寫進你的再行銷名單
- **密碼保護**、**到期時間**、**301 / 302**
- **UTM 產生器**、**QR Code**
- **數據分析** — 裝置 / OS / 來源 / 國家 / 時段 / suffix / A-B 變體
- **無連結數上限、自訂網域、資料 100% 在你自己手上**

---

## 檔案

```
relay/
├─ worker.js       轉址引擎 + 後台 API（部署到 Cloudflare Workers）
├─ schema.sql      D1 資料表
├─ wrangler.toml   Worker 設定（自己的，含 database_id；不進版控）
├─ index.html      單檔後台（可丟 Cloudflare Pages，或本機直接開）
└─ README.md
```

---

## 部署（約 10 分鐘）

### 0. 前置
```bash
npm i -g wrangler
wrangler login
```

### 1. 建立 D1 並匯入 schema
```bash
# 先把設定範本複製成正式檔（你自己的 wrangler.toml 不會進版控）
cp wrangler.toml.example wrangler.toml

wrangler d1 create relay
# 把回傳的 database_id 貼進 wrangler.toml 的 database_id

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

**公開轉址**：`GET /:slug` 或 `GET /:slug/:suffix`（suffix 用來追來源，例如 `/spring/ig`）。

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

## 費用

**完全自架，跑在你自己的 Cloudflare 帳號**——沒有中央伺服器，作者不替任何人付費。對絕大多數人就是 **$0**：

- Workers 免費層：每天 10 萬次請求
- D1 免費層：5GB 儲存、每天數百萬列讀取
- Pages（放後台 `index.html`）：免費

只有超過免費額度才付費，而且付的是**你自己**的 Cloudflare 帳單，跟作者與其他使用者完全無關。fork 下去、填自己的 `database_id` 與 `ADMIN_TOKEN`，這套就 100% 是你的。

---

## 授權 License

[MIT](./LICENSE) © 2026

自由使用、修改、散布、商用，只要保留版權聲明即可。歡迎 fork、star、提 issue。
