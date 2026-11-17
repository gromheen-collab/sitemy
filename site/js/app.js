const IMG = s => `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${s}.png`;
const STAGE = ['Ст. 1','Ст. 1','Ст. 2','Ст. 2','Ст. 3'];
const S = {mode:'ally', side:'radiant', ally:Array(5).fill(null), enemy:Array(5).fill(null), sel:null, me:null, myPos: Math.max(1, Math.min(5, Number(localStorage.getItem('draftMyPos')) || 3)), fresh:null, chosen:null, apos:{ally:Array(5).fill(null), enemy:Array(5).fill(null)}, pools:{1:new Set(),2:new Set(),3:new Set(),4:new Set(),5:new Set()}, q:'', attr:'all', onlyPool:false};
let H = [], byId = {};
try { for (let p = 1; p <= 5; p++) S.pools[p] = new Set(JSON.parse(localStorage.getItem('pool_pos_' + p) || '[]')); } catch (e) {}
try { if (!localStorage.getItem('pool_pos_' + S.myPos) && localStorage.getItem('pool3')) { S.pools[S.myPos] = new Set(JSON.parse(localStorage.getItem('pool3') || '[]')); localStorage.setItem('pool_pos_' + S.myPos, JSON.stringify([...S.pools[S.myPos]])); } } catch (e) {}
Object.defineProperty(S, 'pool', {get(){ return this.pools[this.myPos] || (this.pools[this.myPos] = new Set()); }});
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));
const savePool = () => { try { localStorage.setItem('pool_pos_' + S.myPos, JSON.stringify([...S.pool])); } catch (e) {} ensure(); clearTimeout(CT); CT = setTimeout(collectAll, 2500); };

function slotHTML(team, id, i) {
  const h = byId[id];
  const sel = (S.sel && S.sel.team === team && S.sel.i === i ? ' sel' : '') + (team === 'ally' && S.me === i ? ' mine' : '');
  const fx = S.fresh === team + i ? (team === 'ally' ? ' pop' : ' flip') : '';
  const st = `<i class="st">${STAGE[i]}</i>`;
  if (!h) return `<button class="slot${sel}" data-team="${team}" data-i="${i}">${st}пусто</button>`;
  return `<button class="slot fill${sel}${fx}" data-team="${team}" data-i="${i}" title="Убрать: ${h.localized_name}">${st}<img src="${IMG(h.short)}" alt=""><span class="nm">${h.localized_name}</span></button>`;
}

function render() {
  document.body.classList.toggle('dire', S.side === 'dire');
  $('mylbl').textContent = S.side === 'dire' ? 'Dire' : 'Radiant';
  $('enlbl').textContent = S.side === 'dire' ? 'Radiant' : 'Dire';
  for (const t of ['ally', 'enemy']) $(t).innerHTML = S[t].map((id, i) => slotHTML(t, id, i)).join('');
  $('mebar').innerHTML = 'Слот моего пика:' + STAGE.map((s, i) => `<button data-me="${i}" class="${S.me === i ? 'on' : ''}">${i + 1} (${s})</button>`).join('');
  $('myposbar').innerHTML = 'Моя позиция: ' + [1,2,3,4,5].map(p => `<button data-mypos="${p}" class="${S.myPos === p ? 'on' : ''}">${p}</button>`).join('');
  S.fresh = null;
  loadDmg();
  renderPos();
  renderRecs();
  renderBuild();
  document.querySelectorAll('#side [data-side]').forEach(b => b.classList.toggle('on', b.dataset.side === S.side));
  document.querySelectorAll('#mode [data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === S.mode));
  document.querySelectorAll('#attr [data-attr]').forEach(b => b.classList.toggle('on', b.dataset.attr === S.attr));
  $('onlypool').classList.toggle('on', S.onlyPool);
  renderGrid(); renderPool();
}

function renderGrid() {
  if (!H.length) return;
  const used = new Set([...S.ally, ...S.enemy]);
  const q = S.q.trim().toLowerCase();
  const list = H.filter(h =>
    (S.attr === 'all' || h.primary_attr === (S.attr === 'all2' ? 'all' : S.attr)) &&
    (!S.onlyPool || S.pool.has(h.id)) &&
    (!q || h.localized_name.toLowerCase().includes(q)));
  $('grid').innerHTML = list.length ? list.map(h => {
    const dim = S.mode !== 'pool' && used.has(h.id) ? ' dim' : '';
    const pl = S.pool.has(h.id) ? ' pool' : '';
    return `<button class="hero${dim}${pl}" data-id="${h.id}" title="${h.localized_name}"><img loading="lazy" src="${IMG(h.short)}" alt="" onerror="this.style.visibility='hidden'"><span>${h.localized_name}</span></button>`;
  }).join('') : '<div class="empty">Никого не нашёл. Попробуй другой запрос или фильтр.</div>';
}

function renderPool() {
  $('poolpos').textContent = S.myPos; $('pc').textContent = S.pool.size;
  $('pool').innerHTML = [...S.pool].map(id => byId[id]).filter(Boolean)
    .sort((a, b) => a.localized_name.localeCompare(b.localized_name))
    .map(h => `<button class="chip" data-rm="${h.id}" title="Убрать из пула">${h.localized_name} ×</button>`).join('');
  $('poolhint').style.display = S.pool.size ? 'none' : '';
}

function place(id) {
  if (S.ally.includes(id) || S.enemy.includes(id)) return;
  const t = S.mode === 'enemy' ? 'enemy' : 'ally';
  let i = S.sel && S.sel.team === t && S[t][S.sel.i] == null ? S.sel.i : S[t].indexOf(null);
  if (i < 0) return;
  S[t][i] = id; S.sel = null; S.fresh = t + i; render();
}

$('grid').addEventListener('click', e => {
  const b = e.target.closest('.hero'); if (!b) return;
  const id = +b.dataset.id;
  if (S.mode === 'pool') { S.pool.has(id) ? S.pool.delete(id) : S.pool.add(id); savePool(); render(); }
  else place(id);
});
document.querySelector('.board').addEventListener('click', e => {
  const b = e.target.closest('.slot'); if (!b) return;
  const t = b.dataset.team, i = +b.dataset.i;
  if (S[t][i] != null) { S[t][i] = null; S.apos[t][i] = null; }
  else { S.sel = {team: t, i}; S.mode = t; }
  render();
});
$('pool').addEventListener('click', e => {
  const b = e.target.closest('[data-rm]'); if (!b) return;
  S.pool.delete(+b.dataset.rm); savePool(); render();
});
$('side').addEventListener('click', e => {
  if (e.target.dataset.side) { S.side = e.target.dataset.side; render(); }
});
$('reset').addEventListener('click', () => {
  S.ally.fill(null); S.enemy.fill(null);
  S.apos.ally.fill(null); S.apos.enemy.fill(null);
  S.chosen = null; S.sel = null; S.me = null; S.panel = false; S.after = null;
  S.aiKey = null; S.aiRes = null; S.aiErr = ''; S.aiApply = false;
  render();
});
$('mode').addEventListener('click', e => {
  if (e.target.dataset.mode) { S.mode = e.target.dataset.mode; S.sel = null; render(); }
});
$('attr').addEventListener('click', e => { if (e.target.dataset.attr) { S.attr = e.target.dataset.attr; render(); } });
$('onlypool').addEventListener('click', () => { S.onlyPool = !S.onlyPool; render(); });
$('q').addEventListener('input', e => { S.q = e.target.value; renderGrid(); });

$('mebar').addEventListener('click', e => {
  const b = e.target.closest('[data-me]'); if (!b) return;
  const i = +b.dataset.me; S.me = S.me === i ? null : i; render();
});
$('myposbar').addEventListener('click', e => {
  const b = e.target.closest('[data-mypos]'); if (!b) return;
  const p = Number(b.dataset.mypos);
  if (p < 1 || p > 5 || p === S.myPos) return;
  S.myPos = p;
  try { localStorage.setItem('draftMyPos', String(p)); } catch (_) {}
  recPosVersion++;
  for (const k in D) delete D[k];
  loadErr = '';
  render();
  ensure();
});
const SK = 'stratzToken', RK = 'rankBracket';
const lsGet = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const WK_KEY = 'drafterWeeks2', WK_SEC = 604800;
let WKN = [1, 2, 3, 4].includes(Number(lsGet(WK_KEY))) ? Number(lsGet(WK_KEY)) : 2; // how many weeks to gather: the current (partial) one + WKN-1 full ones
$('tok').value = lsGet(SK); $('rank').value = lsGet(RK) || 'all'; $('wkn').value = String(WKN);
if (/[?&]debug=1(&|$)/.test(location.search)) $('dbg').hidden = false; // diagnostics: open the page with ?debug=1
const provider = () => lsGet(SK) ? 'stratz' : 'opendota';
function srcLabel() {
  if (STATIC) {
    const m = STATIC.meta, rk = curRank(), r = m.ranks[rk] || {}, d = new Date(m.generatedAt), age = (Date.now() - d.getTime()) / 864e5;
    const day = x => x.toLocaleDateString('ru-RU', {day: 'numeric', month: 'numeric'});
    const from = r.weeks && r.weeks.length ? day(new Date(Math.min(...r.weeks) * 604800000)) : '?';
    $('srclbl').innerHTML = 'Данные: <a href="https://stratz.com" target="_blank" rel="noopener">STRATZ</a> · ' + escapeHTML(RANK_LABEL[rk] || rk) + ' · с ' + escapeHTML(from) + ' по ' + escapeHTML(isNaN(d) ? '?' : day(d)) + ' · обновлено ' + escapeHTML(isNaN(d) ? '?' : d.toLocaleString('ru-RU', {day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit'})) + (age > 3 ? ' · ВНИМАНИЕ: данные устарели' : '') + (lsGet(SK) ? '' : '. Токен Stratz нужен только для подсказок по билду.');
    return;
  }
  $('srclbl').textContent = provider() === 'stratz' ? 'Источник: Stratz (токен введён)' : 'Источник: Stratz не подключён. Без токена рекомендаций нет (OpenDota даёт только список героев): вставь токен Stratz.';
}
// ---- Static data mode: the site reads files published by the collector (data/meta.json, data/<rank>/<id>.json ...).
let STATIC = null, BOOTING = true; const SF = {};
const RANK_LABEL = {all: 'Все ранги', HERALD_GUARDIAN: 'Рекрут-Страж', CRUSADER_ARCHON: 'Рыцарь-Герой', LEGEND_ANCIENT: 'Легенда-Властелин', DIVINE_IMMORTAL: 'Божество-Титан'};
const sigTimeout = ms => { try { return AbortSignal.timeout(ms); } catch (e) { return undefined; } };
async function fetchJson(url, opts) { const r = await fetch(url, {signal: sigTimeout(20000), ...opts}); if (!r.ok) throw new Error(url + ': HTTP ' + r.status); return r.json(); }
const curRank = () => STATIC ? (STATIC.ranks.includes(lsGet(RK)) ? lsGet(RK) : STATIC.ranks[0]) : (lsGet(RK) || 'all');
async function detectStatic() {
  if (/[?&]live=1(&|$)/.test(location.search)) return; // ?live=1 forces the old mode with your own Stratz token
  try {
    const m = await fetchJson('data/meta.json', {cache: 'no-cache'});
    const ranks = Object.keys(m.ranks || {}).filter(r => m.ranks[r] && m.ranks[r].heroes > 0);
    if (m.ver !== 1 || m.complete === false || !ranks.length) return;
    STATIC = {meta: m, ranks};
    $('rank').innerHTML = ranks.map(r => '<option value="' + r + '">' + escapeHTML(RANK_LABEL[r] || r) + '</option>').join('');
    $('rank').value = curRank(); $('wkn').style.display = 'none'; $('wkinfo').style.display = 'none';
  } catch (e) {}
}
srcLabel();
$('tok').addEventListener('input', e => { lsSet(SK, e.target.value.trim()); srcLabel(); });
$('rank').addEventListener('change', e => lsSet(RK, e.target.value));
$('rank').addEventListener('change', () => { for (const k in D) delete D[k]; srcLabel(); ensure(); render(); });
$('wkn').addEventListener('change', e => { WKN = Number(e.target.value) || 2; lsSet(WK_KEY, String(WKN)); for (const k in D) delete D[k]; ensure(); render(); });
$('tok').addEventListener('change', () => { ensure(); render(); });
async function probe(query, label) {
  const o = $('out'); o.hidden = false;
  if (!lsGet(SK)) { o.textContent = 'Сначала вставь токен Stratz.'; return; }
  o.textContent = 'Запрос...';
  try {
    const r = await fetch('https://api.stratz.com/graphql', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + lsGet(SK)}, body: JSON.stringify({query})});
    const body = await r.text();
    o.textContent = label + ': HTTP ' + r.status + '\n' + body.slice(0, 6000);
  } catch (e) {
    o.textContent = 'Запрос не дошёл (' + e.message + '). Скорее всего, Stratz не пускает запросы из браузера (CORS) или их блокирует сеть/расширение. Скопируй это сообщение и покажи мне.';
  }
}
$('test').addEventListener('click', () => probe('{ __typename }', 'Проверка связи'));
$('schema').addEventListener('click', () => probe('{ __schema { queryType { fields { name type { name kind } } } } }', 'Поля схемы'));
async function typeInfo(name) {
  const T = 'name kind ofType{name kind ofType{name kind ofType{name kind}}}';
  const r = await fetch('https://api.stratz.com/graphql', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + lsGet(SK)}, body: JSON.stringify({query: `{ __type(name: "${name}") { name kind fields { name args { name type { ${T} } } type { ${T} } } enumValues { name } } }`})});
  const j = await r.json(); return j.data && j.data.__type;
}
const tr = t => !t ? '?' : t.kind === 'NON_NULL' ? tr(t.ofType) + '!' : t.kind === 'LIST' ? '[' + tr(t.ofType) + ']' : t.name;
const base = t => t.ofType ? base(t.ofType) : t.name;
const fmt = t => t.name + ' (' + t.kind + ')\n' + (t.fields || []).map(f => '  ' + f.name + (f.args.length ? '(' + f.args.map(a => a.name + ': ' + tr(a.type)).join(', ') + ')' : '') + ': ' + tr(f.type)).join('\n') + (t.enumValues && t.enumValues.length ? '\n  значения: ' + t.enumValues.map(v => v.name).join(', ') : '');
$('tfields').addEventListener('click', async () => {
  const o = $('out'); o.hidden = false;
  if (!lsGet(SK)) { o.textContent = 'Сначала вставь токен Stratz.'; return; }
  o.textContent = 'Запрос...';
  try {
    const out = [], t = await typeInfo($('tname').value.trim());
    if (!t) { o.textContent = 'Такого типа нет.'; return; }
    
    const mus = (t.fields || []).filter(f => /^(stats|laneoutcome|matchup)$/i.test(f.name));
    for (const mu of mus) {
      out.push('ПОЛЕ ' + mu.name + '(' + mu.args.map(a => a.name + ': ' + tr(a.type)).join(', ') + '): ' + tr(mu.type));
      const m = await typeInfo(base(mu.type));
      if (m) {
        out.push(fmt(m));
        for (const f of (m.fields || []).filter(f => /^(with|vs)$/i.test(f.name))) { const x = await typeInfo(base(f.type)); if (x) out.push(fmt(x)); }
      }
      for (const a of mu.args) {
        const n = base(a.type);
        if (/^(Int|Long|Short|Boolean|String|Byte|DateTime)$/.test(n)) continue;
        const e = await typeInfo(n); if (e && e.kind === 'ENUM') out.push(fmt(e));
      }
    }
    o.textContent = out.join('\n\n');
  } catch (e) { o.textContent = 'Запрос не дошёл (' + e.message + ').'; }
});
const D = {}, K = 300;
let recPosVersion = 0;
let busy = false, again = false, loadErr = '';
const roles = id => (byId[id] && byId[id].roles) || [];
const nm = id => byId[id] ? byId[id].localized_name : '#' + id;
const wr = (a, base) => (a[1] + base * K) / (a[0] + K);
const f1 = x => (x >= 0 ? '+' : '') + x.toFixed(1);
const NEED = {Initiator: 'инициацию', Disabler: 'дизейбл', Durable: 'живучесть'};
function baseWr(d) { let m = 0, w = 0; for (const k in d.v) { m += d.v[k][0]; w += d.v[k][1]; } return m ? w / m : 0.5; }
function merge(o, list) { for (const x of list || []) { const a = o[x.heroId2] || (o[x.heroId2] = [0, 0]); a[0] += +x.matchCount || 0; a[1] += +x.winCount || 0; } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Stratz rows carry a `week`. info = what the API returned (before the window), rows = after the window.
function weekCut(rows) {
  rows = rows || [];
  let mn = Infinity, mx = -Infinity; const seen = new Set();
  for (const x of rows) { const w = +x.week; if (x.week != null && Number.isFinite(w)) { seen.add(w); if (w < mn) mn = w; if (w > mx) mx = w; } }
  return {rows, info: seen.size ? {n: seen.size, min: mn, max: mx} : null};
}
function mergeWk(a, b) { if (!b) return a; if (!a) return {...b}; return {n: Math.max(a.n, b.n), min: Math.min(a.min, b.min), max: Math.max(a.max, b.max)}; }
// Debug probes: what does Stratz actually return (weeks, brackets, duplicates) and what does the `week` argument mean?
function probeStat(rows) {
  rows = rows || []; const wk = new Set(), bk = {}, per = {}; let m = 0;
  for (const x of rows) { if (x.week != null) wk.add(+x.week); const b = x.bracketBasicIds || 'нет'; bk[b] = (bk[b] || 0) + 1; m += +x.matchCount || 0; const k = x.heroId2 != null ? x.heroId2 : x.position; if (k != null) per[k] = (per[k] || 0) + 1; }
  const w = [...wk].sort((a, b) => a - b), mult = Object.values(per);
  return {w, m, n: rows.length, text: `${rows.length} строк, матчей Σ${m}, недель ${w.length}` + (w.length ? ` (${w[0]}–${w[w.length - 1]})` : '') + ', ранги ' + JSON.stringify(bk) + (mult.length ? ', строк на ключ: макс ' + Math.max(...mult) : '')};
}
function probeVerdict(arg, w) { return !w.length ? 'недель в ответе нет' : w.length === 1 && w[0] === arg ? '→ вернул ровно эту неделю' : w.every(x => x >= arg) ? '→ вернул недели начиная с этой' : '→ странно: ' + w.join(','); }
function probeSetup() {
  const o = $('out'); o.hidden = false;
  if (!lsGet(SK)) { o.textContent = 'Сначала вставь токен Stratz.'; return null; }
  const id = [...S.pool][0] || S.chosen || (H[0] && H[0].id);
  if (!id) { o.textContent = 'Нет героя для проверки: добавь героя в пул.'; return null; }
  const out = [], show = () => { o.textContent = out.join('\n'); };
  const run = async (label, q, pick, arg) => {
    try { const s = probeStat(pick(await gq(q))); out.push(label + ': ' + s.text + (arg != null ? ' ' + probeVerdict(arg, s.w) : '')); show(); await sleep(150); return s; }
    catch (e) { out.push(label + ': ошибка ' + e.message); show(); return {w: [], m: 0, n: 0}; }
  };
  const pos = S.myPos;
  const lq = x => `{ heroStats { laneOutcome(heroId: ${id}, isWith: false${x || ''}, positionIds: [POSITION_${pos}]) { heroId2 week bracketBasicIds matchCount } } }`;
  const mq = x => `{ heroStats { matchUp(heroId: ${id}${x || ''}, take: 150) { heroId with { heroId2 week bracketBasicIds matchCount } vs { heroId2 week bracketBasicIds matchCount } } } }`;
  const sq = x => `{ heroStats { stats(heroIds: [${id}], groupByPosition: true${x || ''}) { position week bracketBasicIds matchCount } } }`;
  const pickL = d => d.heroStats.laneOutcome, pickS = d => d.heroStats.stats;
  const pickM = k => d => (d.heroStats.matchUp || []).filter(r => r.heroId == id).flatMap(r => r[k] || []);
  return {id, pos, out, show, run, lq, mq, sq, pickL, pickS, pickM};
}
async function probeFeed() {
  const P = probeSetup(); if (!P) return;
  const {id, pos, out, show, run, lq, mq, sq, pickL, pickS, pickM} = P, rk = lsGet(RK), br = rk && rk !== 'all' ? `, bracketBasicIds: [${rk}]` : '';
  out.push(`Герой ${nm(id)} (#${id}), позиция ${pos}, ранг ${rk || 'all'}. Каждая строка: что вернул запрос.`); show();
  const l0 = await run('laneOutcome без week', lq(br), pickL);
  const m0 = await run('matchUp.vs без week', mq(br), pickM('vs'));
  await run('matchUp.with без week', mq(br), pickM('with'));
  const s0 = await run('stats groupByPosition без week', sq(br), pickS);
  const all = [...l0.w, ...m0.w, ...s0.w], mx = all.length ? Math.max(...all) : null;
  if (mx == null) { out.push('Недель в ответах нет совсем: аргумент week проверить не на чем.'); show(); return; }
  for (const w of [mx - 3, mx]) {
    await run(`laneOutcome week=${w}`, lq(br + `, week: ${w}`), pickL, w);
    await run(`matchUp.vs week=${w}`, mq(br + `, week: ${w}`), pickM('vs'), w);
    await run(`stats week=${w}`, sq(br + `, week: ${w}`), pickS, w);
  }
  out.push('Готово. Скопируй всё и покажи мне.'); show();
}
// Probe 2: which format of the `week` argument works, and what does a request without a rank filter really contain?
async function probeWeekFmt() {
  const P = probeSetup(); if (!P) return;
  const {id, pos, out, show, run, lq, mq, sq, pickL, pickS, pickM} = P;
  out.push(`Герой ${nm(id)} (#${id}), позиция ${pos}. Настройка ранга здесь игнорируется.`, '— Формат аргумента week —'); show();
  const base = await run('laneOutcome без аргументов', lq(), pickL);
  const W0 = base.w.length ? base.w[base.w.length - 1] : null;
  if (W0 == null) { out.push('Недель в ответе нет: форматы week проверить не на чем.'); show(); }
  else {
    const fm = [['номер недели', W0, W0], ['номер недели −1', W0 - 1, W0 - 1], ['секунды начала недели', W0 * 604800, W0], ['секунды предыдущей недели', (W0 - 1) * 604800, W0 - 1], ['миллисекунды начала недели', W0 * 604800000, W0]];
    let good = null;
    for (const [name, v, wi] of fm) { const s = await run(`laneOutcome week=${v} (${name})`, lq(`, week: ${v}`), pickL, wi); if (s.n > 0 && !good) good = {name, v, wi}; }
    if (good) {
      out.push(`→ формат «${good.name}» работает. Проверяю его на остальных запросах.`); show();
      await run(`matchUp.vs week=${good.v}`, mq(`, week: ${good.v}`), pickM('vs'), good.wi);
      await run(`stats week=${good.v}
