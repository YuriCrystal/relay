#!/usr/bin/env node
// pick-formula.mjs — recommend which social-post formula to use, ranked by
// real break-out-of-follower-bubble evidence. Pairs with rank.mjs: rank.mjs
// tells you which channel converts, this tells you how to write the next post.
//
// Formula framework (F1-F27) is derived from Hao0321/claude-skill-social-post
// (MIT, © 2026 駱君昊 / Hao). See tools/CREDITS.md. Formula content is in
// Traditional Chinese — it targets Chinese-language FB / Threads / IG marketing.
//
// Usage:
//   node tools/pick-formula.mjs                          # default: boost reach/CTR
//   node tools/pick-formula.mjs --goal=engage|trust      # change the goal
//   node tools/pick-formula.mjs --no-hype                # skip hype-heavy formulas
//   node tools/pick-formula.mjs --have=mistake,shipped   # what you've got (drops the ones you can't write)
//   node tools/pick-formula.mjs --platform=Threads       # limit to a platform
//   node tools/pick-formula.mjs --data=rank.json         # chain rank.mjs --json output
//   node tools/pick-formula.mjs --json                   # machine-readable
//
// Material tags for --have: progress shipped mistake milestone two-tools tool-experience
//   external-entity giveaway contributors in-progress speech-or-book scarce-resource
//   roundup-material video-work mentor-story shipped-with-questions tool-unblock-anxiety
//   news-contrarian-insider hidden-portfolio two-sided-debate screenshot product-giveaway trust-crisis

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const { formulas } = JSON.parse(readFileSync(join(here, 'formulas.json'), 'utf8'));

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);
const goal = ({ ctr: 'reach', clicks: 'reach', reach: 'reach', engage: 'engage', trust: 'trust' })[(flags.goal || 'reach').toLowerCase()] || 'reach';
const noHype = !!flags['no-hype'];
const platform = flags.platform || null;
const have = flags.have ? new Set(String(flags.have).split(',').map((s) => s.trim())) : null;

// chain rank.mjs --json: data pattern -> preferred formula
let dataHint = null;
if (flags.data) {
  try {
    const r = JSON.parse(readFileSync(String(flags.data), 'utf8'));
    const rec = r.recommend || {};
    if (rec.highTrafficLowConv) dataHint = { boost: 'F9', why: `data has a high-traffic / low-conversion channel (${rec.highTrafficLowConv.channel}) -> an honest "I was wrong" angle fits` };
    else if (rec.winner && rec.winner.tag === '🏆 high-converting') dataHint = { boost: 'F23', why: `data has a high-converting winner (${rec.winner.channel}) -> a contrarian show-your-work angle fits` };
    else if (rec.promising) dataHint = { boost: 'F12', why: `a high-converting but small-sample channel -> build-in-public live-ops fits` };
  } catch (e) { console.error('Failed to read --data:', e.message); }
}

const scored = formulas.map((f) => {
  let score = (f[goal] || 0) * 20; // base 0-100
  const notes = [];

  if (noHype) {
    if (f.hype === 'high') { score = -1; notes.push('hype-heavy (skipped)'); }
    else if (f.hype === 'med') { score *= 0.7; notes.push('some hype'); }
  }
  if (platform && !(f.platforms || []).includes(platform)) { score *= 0.45; notes.push(`not a ${platform} formula`); }
  if (have && (f.requires || []).length) {
    const missing = (f.requires || []).filter((r) => !have.has(r));
    if (missing.length) { score *= 0.12; notes.push(`missing material: ${missing.join(',')}`); }
    else { score += 8; notes.push('material ready'); }
  }
  if (dataHint && f.id === dataHint.boost) { score += 18; notes.push('★ ' + dataHint.why); }

  return { ...f, score: Math.round(score), notes };
}).filter((f) => f.score > 0)
  .sort((a, b) => b.score - a.score || b[goal] - a[goal] || b.effort - a.effort);

const goalLabel = { reach: 'reach / CTR (get seen by new people)', engage: 'engagement (comments)', trust: 'trust' }[goal];

if (flags.json) {
  console.log(JSON.stringify({ goal, noHype, platform, have: have ? [...have] : null, dataHint, ranked: scored.slice(0, 8) }, null, 2));
  process.exit(0);
}

const w = (s) => { let n = 0; for (const c of String(s)) n += c.charCodeAt(0) > 127 ? 2 : 1; return n; };
const pad = (s, n) => String(s) + ' '.repeat(Math.max(1, n - w(s)));
console.log(`\n== Which formula? goal: ${goalLabel}${noHype ? ' · no-hype' : ''} ==`);
if (have) console.log('materials: ' + [...have].join(', '));
if (dataHint) console.log('data hint: ' + dataHint.why);
console.log('-'.repeat(66));
console.log(pad('#', 3) + pad('formula', 30) + pad('reach', 8) + pad('engage', 9) + 'effort');
scored.slice(0, 6).forEach((f, i) => {
  console.log(pad(i + 1, 3) + pad(`${f.id} ${f.name}`, 30) + pad('★'.repeat(f.reach), 8) + pad('★'.repeat(f.engage), 9) + '★'.repeat(f.effort));
});
console.log('-'.repeat(66));
console.log('\n== Top 3 ==');
scored.slice(0, 3).forEach((f, i) => {
  console.log(`${i + 1}. ${f.id} | ${f.name}`);
  if (f.proof) console.log(`   evidence: ${f.proof}`);
  console.log(`   why: ${f.note}`);
  if ((f.requires || []).length) console.log(`   needs: ${f.requires.join(', ')}` + (f.freq ? `   cadence: ${f.freq}` : ''));
  if (f.notes.length) console.log(`   note: ${f.notes.join('; ')}`);
});
console.log('\nNext: take the top formula + your winning channel from rank.mjs, and write the post on that skeleton.');
console.log('Let the data decide what to write — you don\'t need to put the numbers in the post itself.\n');
