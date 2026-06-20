// Dependency-free unit tests for Relay's pure helpers (run with: node --test).
// These cover the security / privacy / parsing logic; D1/KV integration is not exercised here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isBot, refHost, normSlug, hostOf, blocklistedHost, assertHttp,
  applyUtm, pickTarget, parseUA, safeParse, sha256, localDay,
} from '../worker.js';

test('isBot: real humans are NOT flagged', () => {
  const humans = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 11; Cubot P50) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 YaBrowser/24.1 Yandex Safari/537.36',
    'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Instagram 329.0.0.0',
    'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 [FBAN/FBIOS;FBAV/452.0.0]',
    'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Twitter for iPhone',
  ];
  for (const ua of humans) assert.equal(isBot(ua), false, ua);
});

test('isBot: crawlers / tools ARE flagged', () => {
  const bots = [
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
    'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
    'TelegramBot (like TwitterBot)',
    'WhatsApp/2.23.20.0 A',
    'Twitterbot/1.0',
    'curl/8.4.0',
    'python-requests/2.31.0',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'Mozilla/5.0 (compatible; SomeRandomBot/1.0)',
  ];
  for (const ua of bots) assert.equal(isBot(ua), true, ua);
});

test('refHost reduces a referrer to its hostname only', () => {
  assert.equal(refHost('https://mail.google.com/u/0/inbox?q=secret'), 'mail.google.com');
  assert.equal(refHost('https://t.co/abc'), 't.co');
  assert.equal(refHost(''), '');
  assert.equal(refHost(null), '');
  assert.equal(refHost('not a url'), '');
});

test('normSlug keeps only [A-Za-z0-9_-] and trims slashes/spaces', () => {
  assert.equal(normSlug('  /Spring Sale!  '), 'Spring-Sale');
  assert.equal(normSlug('/a/'), 'a');
  assert.equal(normSlug('héllo✓world'), 'hlloworld'); // 非 ASCII 直接移除（不做轉寫）
});

test('blocklistedHost matches host and subdomains, not partials', () => {
  assert.equal(blocklistedHost('evil.com', { BLOCKLIST: 'evil.com, foo.com' }), true);
  assert.equal(blocklistedHost('a.evil.com', { BLOCKLIST: 'evil.com' }), true);
  assert.equal(blocklistedHost('good.com', { BLOCKLIST: 'evil.com' }), false);
  assert.equal(blocklistedHost('notevil.com', { BLOCKLIST: 'evil.com' }), false);
  assert.equal(blocklistedHost('evil.com', {}), false);
});

test('assertHttp rejects non-http(s) schemes', () => {
  assert.throws(() => assertHttp('javascript:alert(1)'));
  assert.throws(() => assertHttp('data:text/html,x'));
  assert.throws(() => assertHttp('not a url'));
  assert.doesNotThrow(() => assertHttp('https://ok.com/a'));
  assert.doesNotThrow(() => assertHttp('http://ok.com'));
});

test('hostOf lowercases the host', () => {
  assert.equal(hostOf('https://Example.COM/x'), 'example.com');
  assert.equal(hostOf('garbage'), '');
});

test('applyUtm appends utm params; passes through invalid targets', () => {
  const out = applyUtm('https://x.com/p', JSON.stringify({ source: 'ig', medium: 'social' }));
  assert.ok(out.includes('utm_source=ig'));
  assert.ok(out.includes('utm_medium=social'));
  assert.equal(applyUtm('not-a-url', JSON.stringify({ source: 'ig' })), 'not-a-url');
  assert.equal(applyUtm('https://x.com', ''), 'https://x.com');
});

test('pickTarget routes by device and falls back to default/target', () => {
  const dev = { mode: 'device', variants_json: JSON.stringify({ ios: 'https://i', android: 'https://a', default: 'https://d' }) };
  assert.deepEqual(pickTarget(dev, { os: 'iOS' }), { url: 'https://i', variant: 'ios' });
  assert.deepEqual(pickTarget(dev, { os: 'Android' }), { url: 'https://a', variant: 'android' });
  assert.deepEqual(pickTarget(dev, { os: 'Windows' }), { url: 'https://d', variant: 'default' });
  assert.equal(pickTarget({ mode: 'simple', target_url: 'https://t' }, {}).url, 'https://t');
});

test('parseUA extracts os/device/browser', () => {
  const a = parseUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) Safari');
  assert.equal(a.os, 'iOS'); assert.equal(a.device, 'mobile');
  const b = parseUA('Mozilla/5.0 (Windows NT 10.0) Chrome/124 Safari');
  assert.equal(b.os, 'Windows'); assert.equal(b.browser, 'Chrome');
});

test('safeParse returns fallback on bad JSON', () => {
  assert.deepEqual(safeParse('[1,2]', null), [1, 2]);
  assert.equal(safeParse('{bad', 'fb'), 'fb');
  assert.equal(safeParse('', 'fb'), 'fb');
});

test('sha256 matches a known vector', async () => {
  assert.equal(await sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('localDay applies the configured timezone offset', () => {
  const ms = Date.UTC(2026, 5, 20, 18, 0, 0); // 2026-06-20 18:00 UTC
  assert.equal(localDay({ TZ_OFFSET: '8' }, ms), '2026-06-21'); // +8 crosses midnight
  assert.equal(localDay({ TZ_OFFSET: '0' }, ms), '2026-06-20');
});
