# Relay · self-hosted link shortener

**English** · [繁體中文](README.zh-TW.md)

[![CI](https://github.com/YuriCrystal/relay/actions/workflows/ci.yml/badge.svg)](https://github.com/YuriCrystal/relay/actions/workflows/ci.yml)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YuriCrystal/relay)

A link shortener you fully own, running on the Cloudflare edge.
A **single Worker** is both the redirect engine and the admin API, data lives in **D1**, and the admin dashboard is a **single `index.html`** (zero build, zero external dependencies).

Just open `index.html` in a browser to try it — it defaults to **DEMO mode** (fake data; create / edit / view analytics). Follow the steps below to go live for real in about 10 minutes.

> Core idea: a short link isn't just "making a URL shorter" — it's **a relay station you control**. Every link passes through your station before redirecting out, so you can **track performance, change destinations any time, and build a retargeting audience**.

---

## Why Relay?

Link shorteners are everywhere — so why self-host one? Because **with a free link shortener, you're really paying with your own traffic data** — and the features you actually want are usually locked behind a paywall. Relay puts that relay station back in your own hands:

**Change the destination without changing the link**
Campaign rotates, landing page moves, a partner drops out — repoint the link from the dashboard any time. Links you've already posted or printed never need to change.

**See which channel actually drives clicks**
Add a suffix to the same link to split sources: `/spring/ig`, `/spring/threads`, `/spring/edm` each count separately. Which platform, which creator works — read it off the numbers instead of guessing.

**Turn clickers into your retargeting audience**
Links can carry FB Pixel / GA4 / GTM — visitors are written into your retargeting list *before* they even reach the destination. Every click becomes an audience touchpoint instead of leaking away.

**A/B test landing pages on the same link**
Weighted split to see which variant converts; or route iOS / Android to different destinations by device.

**Your data, 100% yours**
Links, clicks, and audience all go into your own Cloudflare D1. No third party reading your traffic, nobody moving features behind a paywall, no links dying because a service shut down.

**Free, no limits, your domain**
Runs on your own Cloudflare free tier (100k redirects/day is plenty), no cap on the number of links, and you can attach your own short domain (`go.yourbrand.com`).

### Who it's for
- Creators, marketers, and small teams running multiple platforms / accounts who want to know where attention and results come from
- People who value data ownership and don't want to be locked into — or priced up by — a SaaS
- Anyone who wants short-link infrastructure they **fully own** and can modify and extend

### Who it's not for (straight talk)
- If you just shorten the occasional URL and don't care about data — a ready-made service like Bitly is less hassle
- If you don't want to touch a terminal at all — Relay needs a few `wrangler` commands (~10 min) to go live

---

## Features

- **Link redirect** — edge redirects, low latency worldwide
- **Change destination without changing the link** — repoint a posted link any time from the dashboard
- **Weighted A/B split** — randomly send the same link to different versions by weight
- **Device routing** — iOS / Android / other to different destinations
- **`/suffix` source tracking** — add a suffix (e.g. `/spring/ig`) to count sources separately and see which channel works
- **Marketing pixel interstitial** — FB Pixel / GA4 / GTM: clickers are added to your retargeting list before they reach the site
- **Password protection**, **expiry**, **301 / 302**
- **UTM builder**, **QR code**
- **Analytics** — device / OS / referrer / country / hour / suffix / A-B variant
- **No link cap, custom domain, data 100% in your own hands**
- **Unique visitors** — total clicks plus a privacy-preserving daily unique count (IP / UA never stored)
- **CSV / JSON export** — download your raw click data any time
- **Optional edge cache & auto-retention** — KV-cached redirects for scale; Cron-pruned old clicks

---

## Files

```
relay/
├─ worker.js       redirect engine + admin API (deploys to Cloudflare Workers)
├─ schema.sql      D1 tables
├─ wrangler.toml   Worker config (committed; D1 auto-provisions, secrets stay out)
├─ index.html      single-file admin (drop on Cloudflare Pages, or open locally)
└─ README.md
```

---

## Deploy

**One-click:** click the **Deploy to Cloudflare** button above — it forks the repo, provisions D1 (and KV if you enable it), and deploys. Then run the two commands below to load the schema and set your `ADMIN_TOKEN`.

**Or step by step (~10 minutes):**

### 0. Prerequisites
```bash
npm i -g wrangler
wrangler login
```

### 1. Create D1 and import the schema
```bash
wrangler d1 create relay
# Paste the returned database_id into wrangler.toml (uncomment the database_id line)

wrangler d1 execute relay --remote --file=./schema.sql        # cloud
# wrangler d1 execute relay --local  --file=./schema.sql       # local testing
```

### 2. Set the admin secret
```bash
wrangler secret put ADMIN_TOKEN
# Enter a long random string — this is your admin login key
```

### 3. Deploy the Worker
```bash
wrangler deploy
# You get a URL, e.g. https://relay.<your-subdomain>.workers.dev
```

### 4. Connect the dashboard
1. Open `index.html` in a browser (or drop it on Cloudflare Pages).
2. Go to **Settings** on the left and fill in:
   - **Worker API URL**: the URL from the previous step
   - **Admin key**: the `ADMIN_TOKEN` you set in step 2
3. Click **Test connection** — success means you're done. The key lives only in your browser's localStorage.

---

## Custom short domain (optional)

1. Add your domain to Cloudflare (e.g. `relay.to`).
2. Uncomment the `[[routes]]` block at the bottom of `wrangler.toml` and set `pattern`.
3. `wrangler deploy`. Your short links are now `https://relay.to/spring`.

---

## API (all require `Authorization: Bearer <ADMIN_TOKEN>`)

| Method | Path | Description |
|---|---|---|
| GET | `/api/overview` | summary numbers + 14-day trend + top links |
| GET | `/api/links` | link list (with click counts) |
| POST | `/api/links` | create a link |
| GET | `/api/links/:id` | single link |
| PATCH | `/api/links/:id` | update |
| DELETE | `/api/links/:id` | delete (along with its click records) |
| GET | `/api/stats/:id?days=30` | trend + device/OS/country/referrer/suffix/variant/hour |
| GET | `/api/export?format=csv\|json&id=&days=` | export clicks (CSV or JSON; optional `id` / `days` filters) |

**Public redirect**: `GET /:slug` or `GET /:slug/:suffix` (suffix tracks the source, e.g. `/spring/ig`).

---

## Before going live

1. **Destination URLs**: on create/update, only `http(s)` is accepted, blocking abusable schemes like `javascript:` / `data:` at the source.
2. **Abuse protection**: a destination-domain blocklist is built in — set `BLOCKLIST = "a.com,b.com"` in `wrangler.toml` to block those domains (and subdomains), zero key needed. For more, set `SAFEBROWSING_KEY` (`wrangler secret put`) and links are checked against Google Safe Browsing on creation; leave it unset = disabled, still runs fine.
3. **Timezone**: dashboard stats (today's clicks / daily trend / hour heatmap) use `TZ_OFFSET` in `wrangler.toml`, default `+8` (Taiwan). Change it to your timezone elsewhere.

> The QR code is generated **locally in the browser by the inlined qrcode-generator (MIT)** — it hits no third-party endpoint, so your link targets never leak and you don't depend on an external service staying up.

---

## Security notes

- The admin API requires a Bearer token throughout; the token is stored via `wrangler secret`, never committed.
- Link passwords are stored hashed as `sha256(slug + ':' + password)`, never in plaintext.
- All D1 queries use bound prepared statements to avoid SQL injection.
- Destination URLs on the interstitial page are safely embedded via `JSON.stringify` / attribute escaping to avoid XSS.
- Destinations only allow `http` / `https`, blocking dangerous schemes like `javascript:` / `data:` at the source.
- The QR code is generated locally in the browser (inlined qrcode-generator), hitting no external endpoint.
- `robots.txt` defaults to `Disallow: /`, so short links aren't indexed by search engines.

---

## Privacy

Relay is built to be privacy-friendly by default — it tracks link clicks, not people:

- **No cookies, no tracking script.** Clicks are counted server-side at redirect time; nothing runs in the visitor's browser and no cross-site identifier is set.
- **No IP stored.** Only a coarse country code (from Cloudflare's edge) is kept — never the raw IP address.
- **No raw User-Agent stored.** Only the derived device / OS / browser is kept; the full UA string (a fingerprinting vector) is discarded.
- **Referrer reduced to its domain.** Only the source host (e.g. `google.com`) is stored — never the full URL with its path or query string.
- **Bots excluded.** Link-preview crawlers (Facebook, Slack, Discord, Telegram, etc.) are still redirected so previews work, but aren't counted and don't fire your pixels — so your numbers are real human clicks.
- **Honors opt-out (optional).** Set `RESPECT_DNT = "1"` and visitors sending `DNT` / `Sec-GPC` are redirected without being recorded.
- **Your data, your server.** Everything lives in your own Cloudflare D1; nobody else can read it.

> Marketing pixels (FB / GA4 / GTM) are opt-in per link — only links you attach a pixel to load one, and only for real human visitors.

---

## Scaling & upgrading (optional)

- **Edge cache** — bind a KV namespace as `LINKS_KV` (see `wrangler.toml`) and redirects read from KV first, cutting D1 reads and latency at scale. Edits still take effect within `CACHE_TTL` (default 60s). Not bound = always read D1 (instant, current behavior).
- **Auto-retention** — set `RETENTION_DAYS` and enable the `[triggers]` cron; clicks older than N days are pruned daily. Unset = keep forever.

> **Upgrading from an earlier version?** The unique-visitor feature adds a column — run this once against your D1:
> ```sql
> ALTER TABLE clicks ADD COLUMN visitor_hash TEXT DEFAULT '';
> ```
> Fresh installs already include it via `schema.sql`. Without it, click recording fails silently until the column is added.

---

## Cost

**Fully self-hosted, running on your own Cloudflare account** — there's no central server, and the author doesn't pay for anyone. For most people it's **$0**:

- Workers free tier: 100k requests/day
- D1 free tier: 5GB storage, millions of row reads per day
- Pages (hosts the `index.html` admin): free

You only pay past the free tier, and you pay **your own** Cloudflare bill — nothing to do with the author or other users. Fork it, fill in your own `database_id` and `ADMIN_TOKEN`, and it's 100% yours.

---

## Development

Pure `node:test` unit tests cover the redirect / privacy / parsing helpers — zero dependencies:

```bash
node --test
```

CI runs them on every push and PR (`.github/workflows/ci.yml`).

---

## License

[MIT](./LICENSE) © 2026

Free to use, modify, distribute, and sell — just keep the copyright notice. Forks, stars, and issues welcome.
