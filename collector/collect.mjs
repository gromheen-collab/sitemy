// Dota draft helper: data collector.
// Pulls hero statistics from the STRATZ GraphQL API and writes static JSON files for the site.
// Node 20+, no dependencies. The token comes only from the STRATZ_TOKEN environment variable.
import fs from 'node:fs/promises';
import path from 'node:path';

const env = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const clamp = (v, a, b) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : a));
const CFG = {
  token: env('STRATZ_TOKEN', ''),
  api: env('STRATZ_URL', 'https://api.stratz.com/graphql'),
  heroesUrl: env('HEROES_URL', 'https://api.opendota.com/api/heroes'),
  ua: env('USER_AGENT', 'STRATZ_API'),
  ranks: env('RANKS', 'DIVINE_IMMORTAL').split(',').map(s => s.trim()).filter(Boolean),
  weeks: clamp(+env('WEEKS', '3'), 1, 4),            // the current (partial) week + WEEKS-1 full ones
  heroes: env('HEROES', '').split(',').map(s => +s.trim()).filter(Boolean),
  out: env('OUT', 'data'),
  cache: env('CACHE', '.cache'),
  rps: clamp(+env('RPS', '3'), 0.2, 20),             // requests per second
  hourly: clamp(+env('HOURLY_LIMIT', '1100'), 1, 100000), // requests per sliding window
  windowMs: clamp(+env('WINDOW_MS', '3600000'), 100, 86400000),
  maxReq: clamp(+env('MAX_REQ', '8000'), 1, 1e6),
  minShare: +env('MIN_POS_SHARE', '0.08'),           // a position counts if it is >= 8% of the hero's games...
  minPosN: +env('MIN_POS_MATCHES', '200'),           // ...and has at least this many games
  maxPos: clamp(+env('MAX_POS', '3'), 1, 5),
  maxFailPct: +env('MAX_FAIL_PCT', '5'),
};
const RANKS_OK = ['all', 'HERALD_GUARDIAN', 'CRUSADER_ARCHON', 'LEGEND_ANCIENT', 'DIVINE_IMMORTAL'];
const WK = 604800; // seconds per Stratz "week"; the `week` argument takes the epoch second of the week start

class Fatal extends Error {}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// ---------- request limiter + GraphQL client ----------
const stamps = []; let lastAt = 0, rps = CFG.rps, requests = 0; const byKind = {};
async function throttle() {
  for (;;) {
    const now = Date.now();
    while (stamps.length && now - stamps[0] > CFG.windowMs) stamps.shift();
    let wait = Math.max(0, lastAt + 1000 / rps - now);
    if (stamps.length >= CFG.hourly) wait = Math.max(wait, stamps[0] + CFG.windowMs - now + 50);
    if (wait <= 0) break;
    await sleep(wait);
  }
  lastAt = Date.now(); stamps.push(lastAt);
}
async function gq(query, kind) {
  let delay = 2000;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (requests >= CFG.maxReq) throw new Fatal('MAX_REQ reached (' + CFG.maxReq + ')');
    await throttle(); requests++; byKind[kind] = (byKind[kind] || 0) + 1;
    let res;
    try {
      res = await fetch(CFG.api, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + CFG.token, 'User-Agent': CFG.ua},
        body: JSON.stringify({query}), signal: AbortSignal.timeout(60000),
      });
    } catch (e) { await sleep(delay); delay *= 2; continue; }
    if (res.status === 429 || res.status >= 500) {
      const ra = +res.headers.get('retry-after');
      if (res.status === 429) rps = Math.max(1, rps * 0.7);
      await sleep(Math.min(120000, ra > 0 ? ra * 1000 : delay)); delay *= 2; continue;
    }
    if (res.status === 401 || res.status === 403) throw new Fatal('STRATZ answered ' + res.status + ': check the STRATZ_TOKEN secret (and the User-Agent header)');
    let j; try { j = await res.json(); } catch (e) { await sleep(delay); delay *= 2; continue; }
    if (j.errors && j.errors.length) throw new Error(j.errors.map(e => e.message).join('; ').slice(0, 300));
    return j.data;
  }
  throw new Error('no usable answer after retries');
}

// ---------- queries (same shapes the site uses) ----------
const br = r => (r === 'all' ? '' : `, bracketBasicIds: [${r}]`);
const wa = wk => (wk == null ? '' : `, week: ${wk * WK}`);
const Q = {
  pos: (r, wk, ext) => `{ heroStats { stats(groupByPosition: true${br(r)}${wa(wk)}) { heroId position week matchCount${ext ? ' physicalDamage magicalDamage pureDamage disableDuration stunDuration' : ''} } } }`,
  matchUp: (r, id, wk) => `{ heroStats { matchUp(heroId: ${id}${br(r)}${wa(wk)}, take: 150) { heroId with { heroId2 week matchCount winCount } vs { heroId2 week matchCount winCount } } } }`,
  lane: (r, id, wk, p, w) => `{ heroStats { laneOutcome(heroId: ${id}, isWith: ${w}${br(r)}${wa(wk)}, positionIds: [POSITION_${p}]) { heroId2 week matchCount winCount lossCount } } }`,
  time: (r, id, wk, p) => `{ heroStats { stats(heroIds: [${id}]${br(r)}${wa(wk)}, positionIds: [POSITION_${p}], groupByTime: true) { week time matchCount winCount } } }`,
};

// ---------- small helpers ----------
const readJson = async f => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return null; } };
const writeJson = async (f, o) => { await fs.mkdir(path.dirname(f), {recursive: true}); await fs.writeFile(f, JSON.stringify(o)); };
function addPairs(into, rows) { for (const x of rows || []) { const a = into[x.heroId2] || (into[x.heroId2] = [0, 0]); a[0] += +x.matchCount || 0; a[1] += +x.winCount || 0; } }
function mergePairs(a, b) { for (const k in b || {}) { const x = a[k] || (a[k] = [0, 0]); x[0] += b[k][0]; x[1] += b[k][1]; } }
function checkWeek(rows, wk) { for (const r of rows || []) if (r.week != null && +r.week !== wk) throw new Error('answer has week ' + r.week + ' instead of ' + wk); }
const maxWeek = rows => rows.reduce((m, x) => (x.week != null && Number.isFinite(+x.week) && +x.week > m ? +x.week : m), -Infinity);

// Positions + per-position damage/control for ALL heroes: one request per week.
async function posWeek(rank, wk, isCurrent) {
  const file = path.join(CFG.cache, rank, 'pos-' + wk + '.json');
  if (!isCurrent) { const c = await readJson(file); if (c) return c; }
  let ext = true, rows;
  try { rows = (await gq(Q.pos(rank, isCurrent ? null : wk, true), 'pos')).heroStats.stats; }
  catch (e) {
    if (e instanceof Fatal) throw e;
    log('  warning: extended position query failed (' + e.message + '), using the basic one');
    ext = false; rows = (await gq(Q.pos(rank, isCurrent ? null : wk, false), 'pos')).heroStats.stats;
  }
  rows = rows || [];
  if (!isCurrent) checkWeek(rows, wk);
  const P = {wk: isCurrent ? maxWeek(rows) : wk, ext, pos: {}, x: {}};
  for (const x of rows) {
    const m = /POSITION_(\d)/.exec(x.position || ''); const c = +x.matchCount || 0; if (!m || !c) continue;
    const p = +m[1], id = x.heroId;
    (P.pos[id] || (P.pos[id] = [0, 0, 0, 0, 0]))[p - 1] += c;
    if (ext) {
      const h = P.x[id] || (P.x[id] = {}), q = h[p] || (h[p] = {n: 0, ph: 0, mg: 0, pu: 0, cc: 0});
      q.n += c; q.ph += (+x.physicalDamage || 0) * c; q.mg += (+x.magicalDamage || 0) * c; q.pu += (+x.pureDamage || 0) * c;
      q.cc += ((+x.disableDuration || 0) || (+x.stunDuration || 0)) * c;
    }
  }
  if (!isCurrent && rows.length) await writeJson(file, P);
  return P;
}

function pickPositions(counts) {
  const tot = counts.reduce((a, b) => a + b, 0); if (!tot) return [];
  const arr = counts.map((n, i) => ({p: i + 1, n})).sort((a, b) => b.n - a.n);
  return arr.filter((x, i) => x.n > 0 && (i === 0 || (x.n >= CFG.minPosN && x.n / tot >= CFG.minShare)))
    .slice(0, CFG.maxPos).map(x => x.p).sort((a, b) => a - b);
}

// One hero, one week: matchUp (position independent) + lane/time stats for each wanted position.
async function heroWeek(rank, id, wk, positions, isCurrent) {
  const file = path.join(CFG.cache, rank, String(wk), id + '.json');
  const P = (!isCurrent && await readJson(file)) || {w: null, v: null, pos: {}};
  let dirty = false;
  if (!P.w) {
    const d = await gq(Q.matchUp(rank, id, wk), 'matchUp');
    P.w = {}; P.v = {};
    for (const row of d.heroStats.matchUp || []) if (row.heroId == id) { checkWeek(row.with, wk); checkWeek(row.vs, wk); addPairs(P.w, row.with); addPairs(P.v, row.vs); }
    dirty = true;
  }
  for (const p of positions) {
    if (P.pos[p]) continue;
    const a = await gq(Q.lane(rank, id, wk, p, false), 'lane'); checkWeek(a.heroStats.laneOutcome, wk);
    const b = await gq(Q.lane(rank, id, wk, p, true), 'lane'); checkWeek(b.heroStats.laneOutcome, wk);
    const s = await gq(Q.time(rank, id, wk, p), 'time'); checkWeek(s.heroStats.stats, wk);
    const lv = {}, lt = {}, t = {};
    addPairs(lv, a.heroStats.laneOutcome); addPairs(lt, b.heroStats.laneOutcome);
    for (const r of s.heroStats.stats || []) { const x = t[r.time] || (t[r.time] = [0, 0]); x[0] += +r.matchCount || 0; x[1] += +r.winCount || 0; }
    P.pos[p] = {lv, lt, sr: Object.keys(t).map(Number).sort((x, y) => x - y).map(k => [k, t[k][0], t[k][1]])};
    dirty = true;
  }
  // Only cache past weeks that really returned data (an empty answer may just mean "not processed yet").
  if (dirty && !isCurrent && Object.keys(P.v).length) await writeJson(file, P);
  return P;
}

async function collectRank(rank, heroList, summary) {
  const t0 = Date.now(), reqStart = requests;
  log(`\n== Rank ${rank} ==`);
  const cur = await posWeek(rank, null, true);
  const W0 = cur.wk;
  if (!Number.isFinite(W0)) throw new Fatal('no week number in the STRATZ answer, nothing to collect');
  const weeks = [W0]; const posParts = [cur];
  for (let i = 1; i < CFG.weeks; i++) {
    try { const P = await posWeek(rank, W0 - i, false); if (Object.keys(P.pos).length) { posParts.push(P); weeks.push(W0 - i); } else log('  warning: week ' + (W0 - i) + ' has no position data'); }
    catch (e) { if (e instanceof Fatal) throw e; log('  warning: week ' + (W0 - i) + ' skipped: ' + e.message); }
  }
  const POS = {}, X = {};
  for (const P of posParts) {
    for (const id in P.pos) { const a = POS[id] || (POS[id] = [0, 0, 0, 0, 0]); P.pos[id].forEach((n, i) => { a[i] += n; }); }
    for (const id in P.x) for (const p in P.x[id]) { const h = X[id] || (X[id] = {}), q = h[p] || (h[p] = {n: 0, ph: 0, mg: 0, pu: 0, cc: 0}), s = P.x[id][p]; for (const k in q) q[k] += s[k]; }
  }
  await writeJson(path.join(CFG.out, rank, 'pos.json'), {ver: 1, rank, weeks, pos: POS, x: X});

  const ok = [], failed = [], nodata = [], rows = [];
  let n = 0;
  for (const h of heroList) {
    n++;
    const positions = pickPositions(POS[h.id] || [0, 0, 0, 0, 0]);
    if (!positions.length) { nodata.push(h.id); continue; }
    const before = requests;
    try {
      const out = {ver: 1, id: h.id, rank, weeks: [], w: {}, v: {}, pos: {}};
      const timeMaps = {};
      for (const wk of weeks) {
        const P = await heroWeek(rank, h.id, wk, positions, wk === W0);
        if (!Object.keys(P.v).length && !Object.keys(P.w).length) continue; // nothing for that week
        out.weeks.push(wk); mergePairs(out.w, P.w); mergePairs(out.v, P.v);
        for (const p of positions) {
          const s = P.pos[p]; if (!s) continue;
          const o = out.pos[p] || (out.pos[p] = {lv: {}, lt: {}, sr: []}), tm = timeMaps[p] || (timeMaps[p] = {});
          mergePairs(o.lv, s.lv); mergePairs(o.lt, s.lt);
          for (const [t, m, w] of s.sr) { const x = tm[t] || (tm[t] = [0, 0]); x[0] += m; x[1] += w; }
        }
      }
      for (const p in out.pos) out.pos[p].sr = Object.keys(timeMaps[p] || {}).map(Number).sort((x, y) => x - y).map(k => [k, timeMaps[p][k][0], timeMaps[p][k][1]]);
      if (!out.weeks.length) throw new Error('no data in any week');
      await writeJson(path.join(CFG.out, rank, h.id + '.json'), out);
      ok.push(h.id);
      const vs = Object.values(out.v).reduce((s, a) => s + a[0], 0);
      rows.push({id: h.id, name: h.localized_name || h.name, positions, weeks: out.weeks.length, pairs: Object.keys(out.v).length, vs, req: requests - before});
    } catch (e) {
      if (e instanceof Fatal) throw e;
      failed.push(h.id); log(`  hero ${h.id} FAILED: ${e.message}`);
    }
    if (n % 10 === 0) log(`  [${n}/${heroList.length}] requests so far: ${requests - reqStart}`);
  }
  const sec = Math.round((Date.now() - t0) / 1000);
  summary.push({rank, W0, weeks, ok: ok.length, failed, nodata: nodata.length, requests: requests - reqStart, sec, rows});
  log(`  ${ok.length} heroes ok, ${failed.length} failed, ${nodata.length} without data, ${requests - reqStart} requests, ${sec}s`);
}

async function main() {
  if (!CFG.token) throw new Fatal('STRATZ_TOKEN is not set');
  for (const r of CFG.ranks) if (!RANKS_OK.includes(r)) throw new Fatal('unknown rank ' + r + ' (allowed: ' + RANKS_OK.join(', ') + ')');
  let heroes;
  for (let i = 0; i < 3 && !heroes; i++) { try { const r = await fetch(CFG.heroesUrl, {signal: AbortSignal.timeout(30000)}); if (r.ok) heroes = await r.json(); } catch {} if (!heroes) await sleep(2000); }
  if (!Array.isArray(heroes) || !heroes.length) throw new Fatal('could not load the hero list from ' + CFG.heroesUrl);
  await writeJson(path.join(CFG.out, 'heroes.json'), heroes);
  const list = (CFG.heroes.length ? heroes.filter(h => CFG.heroes.includes(h.id)) : heroes).sort((a, b) => a.id - b.id);
  if (!list.length) throw new Fatal('no heroes selected');
  log(`Heroes: ${list.length}, ranks: ${CFG.ranks.join(',')}, weeks: ${CFG.weeks}, limit: ${CFG.rps}/s and ${CFG.hourly} per window`);

  const summary = [];
  for (const rank of CFG.ranks) await collectRank(rank, list, summary);

  const failedTotal = summary.reduce((s, r) => s + r.failed.length, 0), attempted = list.length * CFG.ranks.length;
  const failPct = attempted ? (failedTotal / attempted) * 100 : 0;
  const complete = failPct <= CFG.maxFailPct;
  const meta = {ver: 1, generatedAt: new Date().toISOString(), source: 'STRATZ', complete, ranks: {}};
  for (const r of summary) meta.ranks[r.rank] = {currentWeek: r.W0, weeks: r.weeks, heroes: r.ok, failed: r.failed};
  await writeJson(path.join(CFG.out, 'meta.json'), meta);

  // Human readable report (shows up on the workflow run page).
  const md = ['## Data collector', '', `Requests: **${requests}** (${Object.entries(byKind).map(([k, v]) => k + ' ' + v).join(', ')}). Status: **${complete ? 'OK' : 'TOO MANY FAILURES'}** (${failedTotal} failed of ${attempted}, limit ${CFG.maxFailPct}%).`, ''];
  for (const r of summary) {
    md.push(`### ${r.rank}: week ${r.W0}, merged weeks ${r.weeks.join(', ')}`, `${r.ok} ok, ${r.failed.length} failed, ${r.nodata} without data, ${r.requests} requests, ${r.sec}s`, '', '| hero | positions | weeks | opponents | games vs | requests |', '|---|---|---|---|---|---|');
    for (const x of r.rows.slice(0, 20)) md.push(`| ${x.name} (#${x.id}) | ${x.positions.join(',')} | ${x.weeks} | ${x.pairs} | ${x.vs} | ${x.req} |`);
    if (r.rows.length > 20) md.push(`| ... ${r.rows.length - 20} more | | | | | |`);
    if (r.failed.length) md.push('', 'Failed: ' + r.failed.join(', '));
    md.push('');
  }
  log('\n' + md.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
  if (!complete) { log('Too many failed heroes: not publishing.'); process.exitCode = 1; }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(e instanceof Fatal ? 2 : 1); });
