-- Relay · D1 schema
-- 執行： wrangler d1 execute relay --file=./schema.sql
-- 本機測試： wrangler d1 execute relay --local --file=./schema.sql

-- 連結主表 ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS links (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT    NOT NULL UNIQUE,           -- 短碼，例如 spring
  title         TEXT    DEFAULT '',                -- 後台顯示用備註
  mode          TEXT    NOT NULL DEFAULT 'simple', -- simple | ab | device
  target_url    TEXT    DEFAULT '',                -- simple 模式的目的地
  variants_json TEXT    DEFAULT '',                -- ab：[{url,weight,label}]  device：{ios,android,default}
  redirect_type INTEGER NOT NULL DEFAULT 302,      -- 301 永久 | 302 暫時
  password_hash TEXT    DEFAULT '',                -- sha256(slug + ':' + 密碼)；空＝不設密碼
  pixel_fb      TEXT    DEFAULT '',                -- FB Pixel ID
  pixel_ga      TEXT    DEFAULT '',                -- GA4 評估 ID  G-XXXX
  pixel_gtm     TEXT    DEFAULT '',                -- GTM 容器 ID  GTM-XXXX
  utm_json      TEXT    DEFAULT '',                -- {source,medium,campaign,term,content}
  expires_at    TEXT    DEFAULT '',                -- ISO 字串；空＝永不過期
  active        INTEGER NOT NULL DEFAULT 1,        -- 1 啟用 0 停用
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_links_slug   ON links(slug);
CREATE INDEX IF NOT EXISTS idx_links_active ON links(active);

-- 點擊事件表 --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clicks (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id   INTEGER NOT NULL,
  slug      TEXT    NOT NULL,
  suffix    TEXT    DEFAULT '',   -- /slug/suffix 帶的 KOL 代號，例如 /spring/aoa
  variant   TEXT    DEFAULT '',   -- 實際導向的變體（ab 的 label 或 device 的 ios/android/default）
  ts        TEXT    NOT NULL,     -- ISO 時間
  ts_day    TEXT    NOT NULL,     -- YYYY-MM-DD，給日彙總用
  ts_hour   INTEGER NOT NULL,     -- 0-23，給時段熱度用
  country   TEXT    DEFAULT 'XX',
  device    TEXT    DEFAULT 'unknown', -- mobile | tablet | desktop
  os        TEXT    DEFAULT 'unknown',
  browser   TEXT    DEFAULT 'unknown',
  referrer  TEXT    DEFAULT '',   -- 只存來源網域（隱私），不存完整網址；原始 UA 不存
  visitor_hash TEXT DEFAULT '',   -- 每日輪替雜湊，僅供「不重複訪客」去重；IP/UA 不落地
  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_clicks_link    ON clicks(link_id);
CREATE INDEX IF NOT EXISTS idx_clicks_day     ON clicks(link_id, ts_day);
CREATE INDEX IF NOT EXISTS idx_clicks_suffix  ON clicks(link_id, suffix);
CREATE INDEX IF NOT EXISTS idx_clicks_variant ON clicks(link_id, variant);
CREATE INDEX IF NOT EXISTS idx_clicks_visitor ON clicks(link_id, visitor_hash);

-- 轉換事件表（cookieless 歸因；落地頁回報「點擊帶來轉換」）------------------
CREATE TABLE IF NOT EXISTS conversions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id   INTEGER NOT NULL,
  slug      TEXT    NOT NULL,
  suffix    TEXT    DEFAULT '',   -- 對應點擊的 /suffix（KOL/渠道）
  variant   TEXT    DEFAULT '',
  event     TEXT    DEFAULT 'conversion',  -- 事件名，如 signup / purchase
  value     REAL    DEFAULT 0,             -- 選填金額/數值
  ts        TEXT    NOT NULL,
  ts_day    TEXT    NOT NULL,
  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_conv_link ON conversions(link_id, ts_day);
