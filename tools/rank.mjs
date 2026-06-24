#!/usr/bin/env node
// rank.mjs — turn Relay's click + conversion data into a channel scoreboard.
// Tells you which /suffix to double down on: not just which gets traffic,
// but which actually converts. Zero dependencies, runs offline.
//
// Usage:
//   node tools/rank.mjs <file.json>
//   curl -s "https://<your-relay>/api/stats/1?days=30" -H "Authorization: Bearer $TOKEN" | node tools/rank.mjs -
//   node tools/rank.mjs data.json --json            # machine-readable
//   node tools/rank.mjs data.json --min-volume=30   # trust threshold (default 20)
//
// Accepted inputs (auto-detected):
//   1) A Relay /api/stats/:id object (has breakdown.suffix + conversions.bySuffix)
//   2) An array of such objects (multiple links)
//   3) { "channels": [ { "link": "spring", "channel": "ig", "clicks": 320, "conversions": 28 } ] }
//   4) A Relay /api/export?format=json array of click rows (clicks only -> ranks by volume)

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);
const fileArg = args.find((a) => !a.startsWith('--')) || '-';
const minVolume = Number(flags['min-volume']) || 20;

const raw = fileArg === '-' ? readFileSync(0, 'utf8') : readFileSync(fileArg, 'utf8');
let input;
try { input = JSON.parse(raw); } catch (e) { console.error('Input is not valid JSON:', e.message); process.exit(1); }

/* Normalize any accepted shape into channel records */
function statsToChannels(s) {
  const slug = (s.link && s.link.slug) || s.slug || '?';
  const convBy = {};
  for (const r of ((s.conversions && s.conversions.bySuffix) || [])) convBy[r.k] = r.n;
  const sfx = (s.breakdown && s.breakdown.suffix) || s.suffix || [];
  return sfx.map((r) => ({ link: slug, channel: r.k, clicks: +r.n || 0, conversions: +(convBy[r.k] || 0), convKnown: true }));
}
function aggregateClicks(rows) {
  const m = new Map();
  for (const r of rows) {
    const key = (r.slug || '?') + ' ' + (r.suffix || '(none)');
    m.set(key, (m.get(key) || 0) + 1);
  }
  return [...m].map(([k, clicks]) => {
    const [link, channel] = k.split(' ');
    return { link, channel, clicks, conversions: 0, convKnown: false };
  });
}
function toChannels(inp) {
  if (Array.isArray(inp)) {
    if (!inp.length) return [];
    const s = inp[0];
    if (s && ('clicks' in s) && (('channel' in s) || ('suffix' in s)))
      return inp.map((r) => ({
        link: r.link || r.slug || '?', channel: r.channel || r.suffix || '(none)',
        clicks: +r.clicks || 0, conversions: +(r.conversions ?? r.conv ?? 0),
        convKnown: ('conversions' in r) || ('conv' in r),
      }));
    if (s && s.breakdown) return inp.flatMap(statsToChannels);
    if (s && ('ts' in s) && ('slug' in s)) return aggregateClicks(inp);
  } else if (inp && typeof inp === 'object') {
    if (Array.isArray(inp.channels)) return toChannels(inp.channels);
    if (inp.breakdown) return statsToChannels(inp);
    if (Array.isArray(inp.stats)) return inp.stats.flatMap(statsToChannels);
  }
  throw new Error('Unrecognized input shape (expected /api/stats object, an array of them, {channels:[…]}, or /api/export rows)');
}

let channels;
try { channels = toChannels(input); } catch (e) { console.error(e.message); process.exit(1); }
channels = channels.filter((c) => c.clicks > 0);
if (!channels.length) { console.error('No usable channel data.'); process.exit(1); }
const convKnown = channels.some((c) => c.convKnown);

/* Wilson 95% lower bound on the conversion rate.
   Penalizes small samples, so "1 click, 1 conversion = 100%" never tops a proven channel. */
function wilsonLower(c, n, z = 1.96) {
  if (!n) return 0;
  const p = c / n, z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n);
}

const totClicks = channels.reduce((a, c) => a + c.clicks, 0);
const totConv = channels.reduce((a, c) => a + c.conversions, 0);
const baseCR = totClicks ? totConv / totClicks : 0;
const clicksSorted = channels.map((c) => c.clicks).sort((a, b) => a - b);
const medClicks = clicksSorted[Math.floor(clicksSorted.length / 2)];

for (const c of channels) {
  c.cr = c.clicks ? c.conversions / c.clicks : 0;
  c.wlb = wilsonLower(c.conversions, c.clicks);
  c.score = convKnown ? c.wlb : c.clicks; // no conversion data -> rank by volume
}
channels.sort((a, b) => b.score - a.score || b.clicks - a.clicks);

function classify(c) {
  if (!convKnown) return { tag: 'traffic', note: '' };
  if (c.clicks < minVolume) return { tag: '🌱 small sample', note: `${c.clicks} clicks < ${minVolume}; conversion rate isn't reliable yet — drive a bit more traffic before judging` };
  if (c.cr >= baseCR * 1.3) return { tag: '🏆 high-converting', note: 'converts well above average — double down here' };
  if (c.clicks >= medClicks * 1.5 && c.cr <= baseCR * 0.7) return { tag: '📈 traffic, low conversion', note: 'clicks come in but don\'t convert — fix the message or landing page, not the reach' };
  if (c.cr <= baseCR * 0.5) return { tag: '💤 cold', note: 'weak on both — don\'t invest yet' };
  return { tag: '➖ average', note: '' };
}
for (const c of channels) Object.assign(c, classify(c));

const trustworthy = channels.filter((c) => !convKnown || c.clicks >= minVolume);
const winner = trustworthy[0] || channels[0];
const highTrafficLowConv = channels.find((c) => c.tag === '📈 traffic, low conversion');
const pct = (x) => (x * 100).toFixed(1) + '%';

if (flags.json) {
  console.log(JSON.stringify({ baseCR, medClicks, convKnown, channels, recommend: { winner, highTrafficLowConv } }, null, 2));
  process.exit(0);
}
const pad = (s, n) => String(s).padEnd(n);
console.log('\n== Channel scoreboard ' + (convKnown ? '(ranked by trustworthy conversion, Wilson lower bound)' : '(no conversion data — ranked by volume)') + ' ==');
console.log('clicks ' + totClicks + (convKnown ? `  conversions ${totConv}  avg rate ${pct(baseCR)}` : ''));
console.log('-'.repeat(70));
console.log(pad('#', 3) + pad('link/channel', 22) + pad('clicks', 8) + pad('conv', 7) + pad('rate', 9) + 'status');
channels.forEach((c, i) => {
  console.log(pad(i + 1, 3) + pad(`${c.link}/${c.channel}`, 22) + pad(c.clicks, 8) + pad(convKnown ? c.conversions : '-', 7) + pad(convKnown ? pct(c.cr) : '-', 9) + c.tag);
});
console.log('-'.repeat(70));
channels.forEach((c) => { if (c.note) console.log(`  - ${c.link}/${c.channel}: ${c.note}`); });
console.log('\n== Next move ==');
if (!convKnown) {
  console.log(`Only traffic data so far. "${winner.channel}" gets the most clicks — keep tagging sources with /suffix and add conversion tracking (/track) to see which one actually converts.`);
} else {
  console.log(`Double down on ${winner.link}/${winner.channel} — it converts best (${pct(winner.cr)}, ${winner.clicks} clicks). Feature it next / give it more budget.`);
  if (highTrafficLowConv && highTrafficLowConv !== winner)
    console.log(`Stop buying reach for "${highTrafficLowConv.channel}" — it pulls clicks but doesn't convert. Fix the message or landing page first.`);
}
console.log('');
