/**
 * Relay — 短網址轉址引擎 + 後台 API（單一 Cloudflare Worker）
 *
 *   公開路由   GET  /:slug              轉址
 *             GET  /:slug/:suffix      轉址並記 KOL 代號（成效追蹤）
 *   後台 API   /api/*                  需 Authorization: Bearer <ADMIN_TOKEN>
 *
 * 綁定（見 wrangler.toml）
 *   DB           D1 資料庫
 *   ADMIN_TOKEN  後台金鑰（用 wrangler secret put 設定）
 *   DASH_ORIGIN  後台網域，給 CORS 用；留空＝放行所有來源（仍需 Bearer）
 */

const RESERVED = new Set(['api', 'favicon.ico', 'robots.txt', '']);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);

    // robots：短網址服務預設不收錄
    if (url.pathname === '/robots.txt') {
      return new Response('User-agent: *\nDisallow: /\n', {
        headers: { 'content-type': 'text/plain' },
      });
    }

    // 後台 API
    if (parts[0] === 'api') {
      return handleApi(request, env, url, parts.slice(1));
    }

    // 根目錄：不洩漏後台，回極簡占位
    if (parts.length === 0) {
      return new Response('Relay', {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    // 轉址：/:slug 或 /:slug/:suffix
    return handleRedirect(request, env, ctx, url, parts);
  },

  // 排程：依 RETENTION_DAYS 清理舊點擊（需在 wrangler.toml 設 [triggers] crons）
  async scheduled(event, env, ctx) {
    ctx.waitUntil(pruneOld(env));
  },
};

/* ───────────────────────── 轉址引擎 ───────────────────────── */

async function handleRedirect(request, env, ctx, url, parts) {
  const slug = parts[0];
  const suffix = parts[1] || '';
  if (RESERVED.has(slug)) return notFound();

  const link = await lookupLink(env, slug);

  if (!link || !link.active) return notFound();

  // 過期
  if (link.expires_at && Date.parse(link.expires_at) < Date.now()) {
    return htmlResponse(pageExpired(), 410);
  }

  // 密碼保護
  if (link.password_hash) {
    const pw = url.searchParams.get('pw') || '';
    const ok = pw && (await sha256(slug + ':' + pw)) === link.password_hash;
    if (!ok) {
      const wrong = url.searchParams.has('pw'); // 有填但錯
      return htmlResponse(pagePassword(slug, suffix, wrong), wrong ? 401 : 200);
    }
  }

  // 依模式挑出目的地
  const ua = request.headers.get('user-agent') || '';
  const agent = parseUA(ua);
  const picked = pickTarget(link, agent);
  if (!picked.url) return notFound();

  let target = applyUtm(picked.url, link.utm_json);

  // 機器人（連結預覽爬蟲）或選擇退出追蹤者：照常轉址，但不記點擊、不觸發像素
  const skipTracking = isBot(ua) || optedOut(request, env);

  // 記點擊（非阻塞）
  if (!skipTracking) {
    ctx.waitUntil(
      recordClick(env, link, { slug, suffix, variant: picked.variant, request, agent, ua })
    );
  }

  // 有像素 → 走中介頁先觸發再導向（機器人不觸發）；否則直接 301/302
  const hasPixel = link.pixel_fb || link.pixel_ga || link.pixel_gtm;
  if (hasPixel && !skipTracking) {
    return htmlResponse(pageInterstitial(link, target), 200);
  }
  return Response.redirect(target, link.redirect_type === 301 ? 301 : 302);
}

function pickTarget(link, agent) {
  if (link.mode === 'ab') {
    const variants = safeParse(link.variants_json, []);
    const valid = variants.filter((v) => v && v.url);
    if (!valid.length) return { url: link.target_url, variant: 'default' };
    const total = valid.reduce((s, v) => s + (Number(v.weight) || 1), 0);
    let r = Math.random() * total;
    for (const v of valid) {
      r -= Number(v.weight) || 1;
      if (r <= 0) return { url: v.url, variant: v.label || v.url };
    }
    return { url: valid[0].url, variant: valid[0].label || valid[0].url };
  }

  if (link.mode === 'device') {
    const d = safeParse(link.variants_json, {});
    if (agent.os === 'iOS' && d.ios) return { url: d.ios, variant: 'ios' };
    if (agent.os === 'Android' && d.android) return { url: d.android, variant: 'android' };
    return { url: d.default || link.target_url, variant: 'default' };
  }

  return { url: link.target_url, variant: 'default' };
}

function applyUtm(target, utmJson) {
  const utm = safeParse(utmJson, null);
  if (!utm) return target;
  try {
    const u = new URL(target);
    const map = {
      source: 'utm_source', medium: 'utm_medium', campaign: 'utm_campaign',
      term: 'utm_term', content: 'utm_content',
    };
    for (const [k, qk] of Object.entries(map)) {
      if (utm[k]) u.searchParams.set(qk, utm[k]);
    }
    return u.toString();
  } catch {
    return target; // target 不是合法 URL 就原樣帶過
  }
}

async function recordClick(env, link, { slug, suffix, variant, request, agent, ua }) {
  const now = new Date();
  const iso = now.toISOString();
  const day = localDay(env, now.getTime());
  const country =
    (request.cf && request.cf.country) ||
    request.headers.get('cf-ipcountry') ||
    'XX';
  // 隱私：referrer 只留來源網域，不存完整網址；原始 UA 與 IP 都不存
  const referrer = refHost(request.headers.get('referer'));
  // 不重複訪客：每日輪替（含當天日期）+ 站台秘密 的雜湊，只拿來去重；IP/UA 只參與運算、不落地
  const ip = request.headers.get('cf-connecting-ip') || '';
  const saltBase = (env && (env.SALT || env.ADMIN_TOKEN)) || 'relay';
  const visitor = (await sha256(saltBase + '|' + slug + '|' + day + '|' + ip + '|' + ua)).slice(0, 16);
  try {
    await env.DB.prepare(
      `INSERT INTO clicks
         (link_id, slug, suffix, variant, ts, ts_day, ts_hour, country, device, os, browser, referrer, visitor_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      link.id, slug, suffix.slice(0, 64), variant, iso,
      day, localHour(env, now.getTime()),
      country, agent.device, agent.os, agent.browser,
      referrer.slice(0, 120), visitor
    ).run();
  } catch (e) {
    // 記錄失敗不可影響轉址（含舊 DB 未加 visitor_hash 欄時）
    console.error('recordClick failed', e);
  }
}

/* ───────────────────────── 後台 API ───────────────────────── */

async function handleApi(request, env, url, seg) {
  const cors = corsHeaders(env, request);
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  // 驗證
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    return json({ error: 'unauthorized' }, 401, cors);
  }

  try {
    // /api/overview
    if (seg[0] === 'overview' && request.method === 'GET') {
      return json(await apiOverview(env), 200, cors);
    }

    // /api/links
    if (seg[0] === 'links' && seg.length === 1) {
      if (request.method === 'GET') return json(await apiList(env), 200, cors);
      if (request.method === 'POST') return json(await apiCreate(env, await request.json()), 201, cors);
    }

    // /api/links/:id
    if (seg[0] === 'links' && seg.length === 2) {
      const id = Number(seg[1]);
      if (request.method === 'GET') return json(await apiGet(env, id), 200, cors);
      if (request.method === 'PATCH') return json(await apiUpdate(env, id, await request.json()), 200, cors);
      if (request.method === 'DELETE') return json(await apiDelete(env, id), 200, cors);
    }

    // /api/stats/:id
    if (seg[0] === 'stats' && seg.length === 2) {
      const id = Number(seg[1]);
      const range = Number(url.searchParams.get('days')) || 30;
      if (request.method === 'GET') return json(await apiStats(env, id, range), 200, cors);
    }

    // /api/export?format=csv|json&id=&days=
    if (seg[0] === 'export' && request.method === 'GET') {
      return await apiExport(env, url, cors);
    }

    return json({ error: 'not found' }, 404, cors);
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 400, cors);
  }
}

async function apiOverview(env) {
  const links = await env.DB.prepare('SELECT COUNT(*) AS n FROM links').first();
  const active = await env.DB.prepare('SELECT COUNT(*) AS n FROM links WHERE active=1').first();
  const clicks = await env.DB.prepare('SELECT COUNT(*) AS n FROM clicks').first();
  const today = localDay(env, Date.now());
  const todayClicks = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM clicks WHERE ts_day = ?'
  ).bind(today).first();
  const uniq = await uniqueCount(env);
  const uniqToday = await uniqueCount(env, 'ts_day = ?', [today]);
  // 近 14 天趨勢
  const series = await env.DB.prepare(
    `SELECT ts_day AS day, COUNT(*) AS n FROM clicks
     WHERE ts_day >= ? GROUP BY ts_day ORDER BY ts_day`
  ).bind(daysAgo(env, 13)).all();
  const top = await env.DB.prepare(
    `SELECT l.id, l.slug, l.title, COUNT(c.id) AS clicks
     FROM links l LEFT JOIN clicks c ON c.link_id = l.id
     GROUP BY l.id ORDER BY clicks DESC LIMIT 5`
  ).all();
  return {
    totals: {
      links: links.n, active: active.n,
      clicks: clicks.n, today: todayClicks.n,
      unique: uniq, uniqueToday: uniqToday,
    },
    series: series.results || [],
    top: top.results || [],
  };
}

async function apiList(env) {
  const rows = await env.DB.prepare(
    `SELECT l.*, COUNT(c.id) AS clicks
     FROM links l LEFT JOIN clicks c ON c.link_id = l.id
     GROUP BY l.id ORDER BY l.created_at DESC`
  ).all();
  return { links: (rows.results || []).map(shapeLink) };
}

async function apiGet(env, id) {
  const link = await env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(id).first();
  if (!link) throw new Error('link not found');
  return { link: shapeLink(link) };
}

async function apiCreate(env, body) {
  const slug = normSlug(body.slug);
  if (!slug) throw new Error('slug 不可空白');
  const dup = await env.DB.prepare('SELECT id FROM links WHERE slug = ?').bind(slug).first();
  if (dup) throw new Error('slug 已被使用');

  const now = new Date().toISOString();
  const f = await normFields(body, env);
  const res = await env.DB.prepare(
    `INSERT INTO links
       (slug,title,mode,target_url,variants_json,redirect_type,password_hash,
        pixel_fb,pixel_ga,pixel_gtm,utm_json,expires_at,active,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    slug, f.title, f.mode, f.target_url, f.variants_json, f.redirect_type,
    f.password_hash, f.pixel_fb, f.pixel_ga, f.pixel_gtm, f.utm_json,
    f.expires_at, 1, now, now
  ).run();
  return { id: res.meta.last_row_id, slug };
}

async function apiUpdate(env, id, body) {
  const link = await env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(id).first();
  if (!link) throw new Error('link not found');

  // 換 slug 要查重複
  let slug = link.slug;
  if (body.slug !== undefined) {
    slug = normSlug(body.slug);
    if (!slug) throw new Error('slug 不可空白');
    const dup = await env.DB.prepare('SELECT id FROM links WHERE slug = ? AND id <> ?')
      .bind(slug, id).first();
    if (dup) throw new Error('slug 已被使用');
  }

  const f = await normFields({ ...link, ...body, password: body.password }, env);
  const active = body.active === undefined ? link.active : (body.active ? 1 : 0);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE links SET
       slug=?, title=?, mode=?, target_url=?, variants_json=?, redirect_type=?,
       password_hash=?, pixel_fb=?, pixel_ga=?, pixel_gtm=?, utm_json=?,
       expires_at=?, active=?, updated_at=?
     WHERE id=?`
  ).bind(
    slug, f.title, f.mode, f.target_url, f.variants_json, f.redirect_type,
    f.password_hash, f.pixel_fb, f.pixel_ga, f.pixel_gtm, f.utm_json,
    f.expires_at, active, now, id
  ).run();
  await invalidate(env, link.slug);
  if (slug !== link.slug) await invalidate(env, slug);
  return { id, slug };
}

async function apiDelete(env, id) {
  const row = await env.DB.prepare('SELECT slug FROM links WHERE id = ?').bind(id).first();
  await env.DB.prepare('DELETE FROM clicks WHERE link_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM links WHERE id = ?').bind(id).run();
  if (row) await invalidate(env, row.slug);
  return { ok: true };
}

async function apiStats(env, id, days) {
  const link = await env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(id).first();
  if (!link) throw new Error('link not found');
  const since = daysAgo(env, days - 1);

  const grp = (col) => env.DB.prepare(
    `SELECT ${col} AS k, COUNT(*) AS n FROM clicks
     WHERE link_id = ? AND ts_day >= ? GROUP BY ${col} ORDER BY n DESC LIMIT 20`
  ).bind(id, since).all();

  const [series, device, os, country, referrer, suffix, variant, hour] = await Promise.all([
    env.DB.prepare(
      `SELECT ts_day AS day, COUNT(*) AS n FROM clicks
       WHERE link_id = ? AND ts_day >= ? GROUP BY ts_day ORDER BY ts_day`
    ).bind(id, since).all(),
    grp('device'), grp('os'), grp('country'),
    grp("CASE WHEN referrer='' THEN '(direct)' ELSE referrer END"),
    grp("CASE WHEN suffix='' THEN '(none)' ELSE suffix END"),
    grp("CASE WHEN variant='' THEN 'default' ELSE variant END"),
    env.DB.prepare(
      `SELECT ts_hour AS k, COUNT(*) AS n FROM clicks
       WHERE link_id = ? AND ts_day >= ? GROUP BY ts_hour ORDER BY ts_hour`
    ).bind(id, since).all(),
  ]);

  const total = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM clicks WHERE link_id = ?'
  ).bind(id).first();
  const uniq = await uniqueCount(env, 'link_id = ?', [id]);

  return {
    link: shapeLink(link),
    total: total.n,
    unique: uniq,
    series: series.results || [],
    breakdown: {
      device: device.results || [],
      os: os.results || [],
      country: country.results || [],
      referrer: referrer.results || [],
      suffix: suffix.results || [],   // KOL 成效
      variant: variant.results || [], // A/B 變體成效
      hour: hour.results || [],
    },
  };
}

/* ───────────────────────── 欄位處理 ───────────────────────── */

async function normFields(body, env) {
  const mode = ['simple', 'ab', 'device'].includes(body.mode) ? body.mode : 'simple';

  const target_url = String(body.target_url || '');

  let variants_json = '';
  if (mode === 'ab') {
    const arr = Array.isArray(body.variants) ? body.variants
      : safeParse(body.variants_json, []);
    const valid = arr.filter((v) => v && v.url).map((v) => ({
      url: String(v.url), weight: Number(v.weight) || 1, label: String(v.label || ''),
    }));
    valid.forEach((v, i) => assertHttp(v.url, 'A/B 第 ' + (i + 1) + ' 個目的地'));
    variants_json = JSON.stringify(valid);
  } else if (mode === 'device') {
    const d = body.variants && typeof body.variants === 'object' && !Array.isArray(body.variants)
      ? body.variants : safeParse(body.variants_json, {});
    const dev = {
      ios: String(d.ios || ''), android: String(d.android || ''), default: String(d.default || ''),
    };
    if (dev.ios) assertHttp(dev.ios, 'iOS 目的地');
    if (dev.android) assertHttp(dev.android, 'Android 目的地');
    if (dev.default) assertHttp(dev.default, '預設目的地');
    variants_json = JSON.stringify(dev);
  } else if (target_url) {
    assertHttp(target_url, '目的地網址');
  }

  // 黑名單 + 選用 Safe Browsing（建立/更新時擋掉惡意或不想要的目的地）
  const dests = mode === 'ab'
    ? safeParse(variants_json, []).map((v) => v.url)
    : mode === 'device'
      ? ['ios', 'android', 'default'].map((k) => safeParse(variants_json, {})[k]).filter(Boolean)
      : (target_url ? [target_url] : []);
  for (const u of dests) {
    const h = hostOf(u);
    if (blocklistedHost(h, env)) throw new Error('目的地網域在黑名單內：' + h);
  }
  const flagged = await safeBrowsingBad(dests, env);
  if (flagged.size) throw new Error('目的地被 Safe Browsing 標記為惡意：' + [...flagged][0]);

  // 密碼：傳 password 才更新；傳空字串＝清除；沒傳就沿用既有 hash
  // hash 綁 slug，避免不同連結同密碼產生同 hash
  let password_hash = body.password_hash || '';
  if (body.password !== undefined) {
    password_hash = body.password
      ? await sha256(normSlug(body.slug || '') + ':' + body.password)
      : '';
  }

  const utm = body.utm && typeof body.utm === 'object' ? body.utm : safeParse(body.utm_json, null);
  const utm_json = utm ? JSON.stringify(pick(utm, ['source', 'medium', 'campaign', 'term', 'content'])) : '';

  return {
    title: String(body.title || ''),
    mode,
    target_url,
    variants_json,
    redirect_type: Number(body.redirect_type) === 301 ? 301 : 302,
    password_hash,
    pixel_fb: String(body.pixel_fb || ''),
    pixel_ga: String(body.pixel_ga || ''),
    pixel_gtm: String(body.pixel_gtm || ''),
    utm_json,
    expires_at: body.expires_at ? String(body.expires_at) : '',
  };
}

function shapeLink(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title || '',
    mode: row.mode,
    target_url: row.target_url || '',
    variants: row.mode === 'ab'
      ? safeParse(row.variants_json, [])
      : row.mode === 'device' ? safeParse(row.variants_json, {}) : null,
    redirect_type: row.redirect_type,
    has_password: !!row.password_hash,
    pixel_fb: row.pixel_fb || '',
    pixel_ga: row.pixel_ga || '',
    pixel_gtm: row.pixel_gtm || '',
    utm: safeParse(row.utm_json, null),
    expires_at: row.expires_at || '',
    active: !!row.active,
    clicks: row.clicks !== undefined ? row.clicks : undefined,
    created_at: row.created_at,
  };
}

/* ───────────────────────── 對外 HTML 頁面 ───────────────────────── */

// 像素中介頁：先觸發 FB/GA4/GTM，再導向；noscript 用 meta refresh 保底
function pageInterstitial(link, target) {
  const t = JSON.stringify(target);              // 安全嵌入 JS 字串
  const metaT = escapeAttr(target);              // 安全嵌入屬性
  let head = '';
  if (link.pixel_fb) {
    head += `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${JSON.stringify(link.pixel_fb)});fbq('track','PageView');</script>`;
  }
  if (link.pixel_ga) {
    const id = JSON.stringify(link.pixel_ga);
    head += `<script async src="https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(link.pixel_ga)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config',${id});</script>`;
  }
  if (link.pixel_gtm) {
    head += `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f)})(window,document,'script','dataLayer',${JSON.stringify(link.pixel_gtm)});</script>`;
  }
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="robots" content="noindex,nofollow">
<meta http-equiv="refresh" content="2;url=${metaT}">
<title>轉址中…</title>${head}
<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;background:#f4f1ea;color:#1c1a17;font-family:"Noto Serif TC",serif}.b{text-align:center}.s{width:34px;height:34px;border:2px solid #d8d2c4;border-top-color:#b03a2e;border-radius:50%;margin:0 auto 14px;animation:r .8s linear infinite}@keyframes r{to{transform:rotate(360deg)}}a{color:#b03a2e}</style></head>
<body><div class="b"><div class="s"></div><div>正在前往目的地…</div>
<noscript><a href="${metaT}">點此繼續</a></noscript></div>
<script>setTimeout(function(){location.replace(${t})},700);</script></body></html>`;
}

function pagePassword(slug, suffix, wrong) {
  const action = escapeAttr('/' + slug + (suffix ? '/' + suffix : ''));
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>需要密碼</title>
<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;background:#f4f1ea;color:#1c1a17;font-family:"Noto Serif TC",serif}.c{width:300px;text-align:center;padding:32px;border:1px solid #d8d2c4;background:#fbf9f4}h1{font-size:18px;font-weight:600;letter-spacing:2px}input{width:100%;box-sizing:border-box;padding:10px;margin:14px 0;border:1px solid #c9c2b2;background:#fff;font-size:15px}button{width:100%;padding:10px;border:none;background:#1c1a17;color:#f4f1ea;letter-spacing:3px;cursor:pointer}.e{color:#b03a2e;font-size:13px;min-height:18px}</style></head>
<body><form class="c" method="get" action="${action}">
<h1>此連結受密碼保護</h1>
<input type="password" name="pw" placeholder="請輸入密碼" autofocus>
<div class="e">${wrong ? '密碼錯誤，請再試一次' : ''}</div>
<button type="submit">前 往</button></form></body></html>`;
}

function pageExpired() {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="robots" content="noindex,nofollow"><title>連結已過期</title>
<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;background:#f4f1ea;color:#1c1a17;font-family:"Noto Serif TC",serif;text-align:center}</style></head>
<body><div><h1 style="letter-spacing:3px">連結已過期</h1><p>This link has expired.</p></div></body></html>`;
}

/* ───────────────────────── 工具 ───────────────────────── */

function parseUA(ua) {
  const u = ua.toLowerCase();
  let os = 'unknown', device = 'desktop', browser = 'unknown';
  if (/iphone|ipod/.test(u)) { os = 'iOS'; device = 'mobile'; }
  else if (/ipad/.test(u)) { os = 'iOS'; device = 'tablet'; }
  else if (/android/.test(u)) { os = 'Android'; device = /mobile/.test(u) ? 'mobile' : 'tablet'; }
  else if (/windows/.test(u)) os = 'Windows';
  else if (/mac os x|macintosh/.test(u)) os = 'macOS';
  else if (/linux/.test(u)) os = 'Linux';
  if (/edg\//.test(u)) browser = 'Edge';
  else if (/chrome|crios/.test(u)) browser = 'Chrome';
  else if (/firefox|fxios/.test(u)) browser = 'Firefox';
  else if (/safari/.test(u)) browser = 'Safari';
  return { os, device, browser };
}

// 已知連結預覽爬蟲 / 抓取器 / 監測工具：用具名 token，避免誤判 App 內建瀏覽器的真人點擊
function isBot(ua) {
  return /crawl|spider|slurp|bot\/|facebookexternalhit|facebot|embedly|quora|skypeuripreview|whatsapp\/|telegrambot|slackbot|discordbot|twitterbot|linkedinbot|pinterest\/|redditbot|applebot|googlebot|bingbot|yandexbot|baiduspider|duckduckbot|petalbot|bytespider|semrush|ahrefs|mj12bot|dotbot|curl\/|wget|python-requests|go-http-client|headlesschrome|phantomjs|lighthouse|pingdom|uptimerobot/i.test(ua);
}

// referrer 只取來源網域，丟掉路徑/查詢字串（隱私 + 統計更乾淨）
function refHost(ref) {
  if (!ref) return '';
  try { return new URL(ref).hostname; } catch { return ''; }
}

// 選用：設了 RESPECT_DNT 才生效，尊重 Do-Not-Track / Global-Privacy-Control
function optedOut(request, env) {
  if (!env || !env.RESPECT_DNT) return false;
  return request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1';
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normSlug(s) {
  return String(s || '').trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9_-]/g, ''); // 只留英數與 - _，避免奇怪字元產生對不上的路由
}

function safeParse(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k]) out[k] = String(obj[k]);
  return out;
}

function tzOffsetHours(env) {
  const n = Number(env && env.TZ_OFFSET);
  return Number.isFinite(n) ? n : 8; // 預設台灣 +8；用 wrangler.toml 的 TZ_OFFSET 改
}
function localDay(env, ms) {
  return new Date(ms + tzOffsetHours(env) * 3600000).toISOString().slice(0, 10);
}
function localHour(env, ms) {
  return new Date(ms + tzOffsetHours(env) * 3600000).getUTCHours();
}
function daysAgo(env, n) {
  return localDay(env, Date.now() - n * 86400000);
}

// 目的地只放行 http/https，擋掉 javascript:/data: 等可被濫用的 scheme
function assertHttp(u, label) {
  let parsed;
  try { parsed = new URL(String(u)); }
  catch { throw new Error((label || '網址') + '不是合法網址'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error((label || '網址') + '只接受 http / https 連結');
  }
}

function hostOf(u) {
  try { return new URL(String(u)).hostname.toLowerCase(); } catch { return ''; }
}

// 目的地網域黑名單：BLOCKLIST 環境變數（逗號分隔），比對主機與其子網域
function blocklistedHost(host, env) {
  if (!host) return false;
  const raw = (env && env.BLOCKLIST) ? String(env.BLOCKLIST) : '';
  const list = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.some((b) => host === b || host.endsWith('.' + b));
}

// 選用：設了 SAFEBROWSING_KEY（wrangler secret）才啟用 Google Safe Browsing 查惡意網址
async function safeBrowsingBad(urls, env) {
  if (!env || !env.SAFEBROWSING_KEY || !urls.length) return new Set();
  try {
    const res = await fetch(
      'https://safebrowsing.googleapis.com/v4/threatMatches:find?key=' + encodeURIComponent(env.SAFEBROWSING_KEY),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client: { clientId: 'relay', clientVersion: '1.0' },
          threatInfo: {
            threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: urls.map((u) => ({ url: u })),
          },
        }),
      }
    );
    if (!res.ok) return new Set(); // 查詢失敗就放行，避免外部服務掛掉導致無法建立連結
    const data = await res.json();
    const bad = new Set();
    for (const m of (data.matches || [])) if (m.threat && m.threat.url) bad.add(m.threat.url);
    return bad;
  } catch { return new Set(); }
}

/* ───────────────────────── 快取 / 匯出 / 清理 ───────────────────────── */

// 轉址查詢：綁了 LINKS_KV 就先讀 KV 快取（短 TTL），miss 再讀 D1 並回填；沒綁＝直接讀 D1
async function lookupLink(env, slug) {
  if (env.LINKS_KV) {
    const cached = await env.LINKS_KV.get('link:' + slug, 'json');
    if (cached) return cached;
    const row = await env.DB.prepare('SELECT * FROM links WHERE slug = ?').bind(slug).first();
    if (row) {
      const ttl = Math.max(60, Number(env.CACHE_TTL) || 60); // KV expirationTtl 最小 60 秒
      await env.LINKS_KV.put('link:' + slug, JSON.stringify(row), { expirationTtl: ttl });
    }
    return row || null;
  }
  return env.DB.prepare('SELECT * FROM links WHERE slug = ?').bind(slug).first();
}

// 連結變動時清掉 KV 快取，讓改動快點生效（沒綁 KV 就是 no-op）
async function invalidate(env, slug) {
  if (env.LINKS_KV && slug) {
    try { await env.LINKS_KV.delete('link:' + slug); } catch (e) { /* 失敗無妨，TTL 也會到期 */ }
  }
}

// 不重複點擊：COUNT(DISTINCT visitor_hash)；舊 DB 無此欄會丟例外 → 回 null（前端就不顯示）
async function uniqueCount(env, where, binds) {
  try {
    const sql = "SELECT COUNT(DISTINCT visitor_hash) AS n FROM clicks WHERE visitor_hash <> ''" +
      (where ? ' AND ' + where : '');
    const r = await env.DB.prepare(sql).bind(...(binds || [])).first();
    return r.n;
  } catch { return null; }
}

// 匯出點擊（CSV / JSON），需 Bearer。?id=<link_id> 篩單一連結、?days=N 篩天數
async function apiExport(env, url, cors) {
  const conds = [], binds = [];
  const id = url.searchParams.get('id');
  const days = Number(url.searchParams.get('days'));
  if (id) { conds.push('link_id = ?'); binds.push(Number(id)); }
  if (Number.isFinite(days) && days > 0) { conds.push('ts_day >= ?'); binds.push(daysAgo(env, days - 1)); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const cols = ['ts', 'slug', 'suffix', 'variant', 'country', 'device', 'os', 'browser', 'referrer'];
  const rows = (await env.DB.prepare(
    `SELECT ${cols.join(', ')} FROM clicks ${where} ORDER BY ts DESC LIMIT 100000`
  ).bind(...binds).all()).results || [];

  if ((url.searchParams.get('format') || 'csv').toLowerCase() === 'json') {
    return new Response(JSON.stringify(rows), {
      headers: { ...cors, 'content-type': 'application/json; charset=utf-8',
        'content-disposition': 'attachment; filename="relay-clicks.json"' },
    });
  }
  const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(','));
  return new Response('\uFEFF' + lines.join('\n'), { // BOM 讓 Excel 正確認 UTF-8
    headers: { ...cors, 'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="relay-clicks.csv"' },
  });
}

// 排程清理：刪掉超過 RETENTION_DAYS 天的點擊（未設或 ≤0 ＝永久保留）
async function pruneOld(env) {
  const days = Number(env.RETENTION_DAYS);
  if (!Number.isFinite(days) || days <= 0) return;
  const cutoff = daysAgo(env, days);
  try { await env.DB.prepare('DELETE FROM clicks WHERE ts_day < ?').bind(cutoff).run(); }
  catch (e) { console.error('prune failed', e); }
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function corsHeaders(env, request) {
  const origin = request.headers.get('origin') || '';
  const allow = env.DASH_ORIGIN && env.DASH_ORIGIN !== '*' ? env.DASH_ORIGIN : (origin || '*');
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-max-age': '86400',
    'vary': 'origin',
  };
}

function json(obj, status, extra) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(extra || {}) },
  });
}

function htmlResponse(html, status) {
  return new Response(html, {
    status: status || 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function notFound() {
  return htmlResponse(
    `<!doctype html><meta charset="utf-8"><title>404</title>
     <body style="background:#f4f1ea;color:#1c1a17;font-family:serif;display:flex;height:100vh;margin:0;align-items:center;justify-content:center">
     <div style="text-align:center"><h1 style="letter-spacing:4px">404</h1><p>查無此連結</p></div></body>`,
    404
  );
}
