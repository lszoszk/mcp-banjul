/**
 * Search and citation-check engine of Banjul Researcher, for Node.
 *
 * The same logic as the website (https://lszoszk.github.io/banjul-researcher/, site/template.html in the build
 * folder): query parsing with phrases, OR, NOT, prefix* and field operators; document filters; paragraph scoring;
 * citation finding and checking. It runs on the same data, which it loads from the published site (docs.json and the
 * paragraph shards p*.json), so the assistant and the website give the same results.
 */
import https from 'node:https';
import http from 'node:http';

export const DATA_BASE = (process.env.DATA_BASE || 'https://lszoszk.github.io/banjul-researcher/').replace(/\/?$/, '/');
const REFRESH_MS = Number(process.env.REFRESH_HOURS || 6) * 3600 * 1000;

export const C = { DOCS: [], HEADS: [], INFO: {}, KNOWN: {}, PARAS: [], FOLD: [], BY_ID: {}, NUMIX: {}, OPS_OF: {}, loadedAt: null };

function getJson(url) {
  const lib = url.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    lib.get(url, { headers: { accept: 'application/json' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`${res.statusCode} for ${url}`)); }
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
      res.on('error', reject);
    }).on('error', reject).setTimeout(60000, function () { this.destroy(new Error('timeout')); });
  });
}

export const fold = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[‘’ʼ`´]/g, "'").replace(/[“”«»]/g, '"');
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const dtext = (d) => d.d ? `${+d.d.slice(8, 10)} ${MONTHS[+d.d.slice(5, 7) - 1]} ${d.d.slice(0, 4)}` : (d.y ? String(d.y) : '');
export const BODY = { Court: "African Court on Human and Peoples' Rights", Commission: "African Commission on Human and Peoples' Rights" };

const STOPN = new Set('and of the for on behalf de des du la le et others other another v republic united federal democratic kingdom state'.split(' '));
const nameTokens = (s) => fold(s).replace(/\([^)]*\)/g, (m) => ' ' + m.slice(1, -1) + ' ').split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOPN.has(w));

export async function load() {
  const data = await getJson(DATA_BASE + 'docs.json');
  const PARAS = new Array(data.info.paras), FOLD = new Array(data.info.paras);
  for (const sh of data.info.shards) {
    const js = await getJson(DATA_BASE + sh.f);
    js.rows.forEach((row, k) => { PARAS[js.start + k] = row; FOLD[js.start + k] = fold(row[4]); });
  }
  const DOCS = data.docs;
  const BY_ID = {}, NUMIX = {}, OPS_OF = {};
  DOCS.forEach((d, i) => {
    d.i = i; d.fst = fold(d.st.join(' | ')); d.fnum = fold(d.num + ' ' + d.id); d.codes = new Set([...d.v, ...d.nv]);
    const [a, b] = d.name.split(' v '); d.appTok = nameTokens(a || ''); d.respFold = fold(b || '');
    BY_ID[d.id] = d;
    if (d.dec) (OPS_OF[d.dec] = OPS_OF[d.dec] || []).push(i);
    if (!d.mt) d.num.replace(/^(App\. Nos?\.|Communications?)\s*/, '').split(/,\s*/).forEach((n) => { if (n) (NUMIX[n] = NUMIX[n] || []).push(i); });
  });
  Object.assign(C, { DOCS, HEADS: data.heads, INFO: data.info, KNOWN: data.known || {}, PARAS, FOLD, BY_ID, NUMIX, OPS_OF, loadedAt: new Date() });
  return C;
}

let loading = null;
export async function ready() {
  if (!C.loadedAt) { loading = loading || load().finally(() => { loading = null; }); await loading; }
  else if (Date.now() - C.loadedAt.getTime() > REFRESH_MS && !loading) {
    loading = load().catch((e) => console.error('[banjul] refresh failed, keeping the old data:', e.message)).finally(() => { loading = null; });
  }
  return C;
}

/* ---------- query parsing (as on the website) ---------- */
const INSTR = { charter: 'Charter', achpr: 'Charter', iccpr: 'ICCPR', icescr: 'ICESCR', udhr: 'UDHR', acdeg: 'ACDEG', ecowas: 'ECOWAS', acrwc: 'ACRWC', acerwc: 'ACRWC', maputo: 'Maputo', cedaw: 'CEDAW', crc: 'CRC', vccr: 'VCCR', protocol: 'Protocol' };
export function artCode(s) {
  const m = /^([a-z]+)?[-_ ]?(\d{1,3})/i.exec(String(s).trim());
  if (!m) return null;
  return `${m[1] ? (INSTR[m[1].toLowerCase()] || m[1]) : 'Charter'} ${m[2]}`;
}
function makeTerm(raw, phrase) {
  let f = fold(raw), prefix = false;
  if (!phrase && /\*$/.test(f) && f.replace(/[^a-z0-9]/g, '').length >= 3) { prefix = true; f = f.slice(0, -1); }
  f = f.replace(/\?/g, '\u0001');
  const words = f.split(/[^a-z0-9'\u0001]+/).filter(Boolean);
  if (!words.length) return null;
  let pat = words.map((w) => reEsc(w).replace(/\u0001/g, '[a-z0-9]')).join('[^a-z0-9]+');
  pat = '(?<![a-z0-9])' + pat + (prefix ? '[a-z0-9]*' : '(?![a-z0-9])');
  return { raw, phrase: phrase || words.length > 1, re: new RegExp(pat, 'g') };
}
export function parse(q) {
  const out = { clauses: [], nots: [], art: [], viol: [], nonviol: [], state: [], cases: [], years: null, body: null };
  const re = /(-)?(?:([a-z]+):)?(?:"([^"]*)"?|([^\s"]+))/gi;
  let m, orNext = false, notNext = false;
  while ((m = re.exec(q))) {
    if (!m[0].trim()) { re.lastIndex++; continue; }
    const neg = !!m[1], field = m[2] && m[2].toLowerCase(), phrase = m[3] !== undefined, val = phrase ? m[3] : m[4];
    if (!field && !phrase) {
      if (val === 'OR') { orNext = true; continue; }
      if (val === 'NOT') { notNext = true; continue; }
      if (val === 'AND') continue;
    }
    if (field) {
      const v = val.trim();
      if (field === 'violation' || field === 'nonviolation' || field === 'article') {
        const codes = v.split('+').map(artCode).filter(Boolean);
        if (codes.length) (field === 'violation' ? out.viol : field === 'nonviolation' ? out.nonviol : out.art).push(codes);
        continue;
      }
      if (field === 'state') { out.state.push(fold(v)); continue; }
      if (field === 'case') { out.cases.push(fold(v)); continue; }
      if (field === 'year') { const y = v.split('-').map(Number); out.years = [y[0], y[1] || y[0]]; continue; }
      if (field === 'body') { out.body = /^c(om|omm)/i.test(v) ? 'Commission' : /^c/i.test(v) ? 'Court' : null; continue; }
    }
    const t = makeTerm(field ? `${field}:${val}` : val, phrase);
    if (!t) continue;
    if (neg || notNext) { out.nots.push(t); notNext = false; orNext = false; continue; }
    if (orNext && out.clauses.length) out.clauses[out.clauses.length - 1].push(t); else out.clauses.push([t]);
    orNext = false;
  }
  return out;
}

/* ---------- filters and search ---------- */
// F: { body, state, year_from, year_to, types[], article, finding: any|violation|no_violation, opinions, decisions, translations, lang }
function docPass(d, F, P) {
  if (d.mt && !F.translations) return false;
  if (F.body && d.b !== F.body) return false;
  if (d.kind === 'opinion' ? !F.opinions : !F.decisions) return false;
  if (F.types && F.types.length && !F.types.some((t) => fold(d.t).includes(fold(t)))) return false;
  if (F.lang && d.lang !== F.lang) return false;
  if (F.state && !d.fst.includes(fold(F.state))) return false;
  if (F.year_from && (!d.y || d.y < F.year_from)) return false;
  if (F.year_to && (!d.y || d.y > F.year_to)) return false;
  const art = F.article ? artCode(F.article) : null;
  if (art) {
    if (F.finding === 'violation' ? !d.v.includes(art) : F.finding === 'no_violation' ? !d.nv.includes(art) : !d.codes.has(art)) return false;
  } else if (F.finding === 'violation' && !d.v.length) return false; else if (F.finding === 'no_violation' && !d.nv.length) return false;
  if (P.body && d.b !== P.body) return false;
  if (P.years && (!d.y || d.y < P.years[0] || d.y > P.years[1])) return false;
  for (const s of P.state) if (!d.fst.includes(s)) return false;
  for (const c of P.cases) if (!d.fnum.includes(c)) return false;
  for (const g of P.viol) if (!g.every((c) => d.v.includes(c))) return false;
  for (const g of P.nonviol) if (!g.every((c) => d.nv.includes(c))) return false;
  for (const g of P.art) if (!g.every((c) => d.codes.has(c))) return false;
  return true;
}
const countMatches = (re, s) => { re.lastIndex = 0; let n = 0; while (re.exec(s) && n < 6) n++; return n; };

export function search(query, F, sort) {
  const P = parse(query || '');
  const docs = C.DOCS.filter((d) => docPass(d, F, P));
  const text = P.clauses.length > 0 || P.nots.length > 0;
  if (!text) {
    const list = docs.slice(); if (sort === 'old') list.reverse();
    return { mode: 'docs', docs: list, P };
  }
  const hits = [];
  for (const d of docs) {
    const from = F.operative_only ? (d.op >= 0 ? d.s + d.op : -1) : d.s;
    if (from < 0) continue;
    for (let i = from; i < d.s + d.c; i++) {
      const f = C.FOLD[i];
      let ok = true, score = 0;
      for (const t of P.nots) { t.re.lastIndex = 0; if (t.re.test(f)) { ok = false; break; } }
      if (!ok) continue;
      for (const cl of P.clauses) {
        let c = 0; for (const t of cl) c += countMatches(t.re, f) * (t.phrase ? 2 : 1);
        if (!c) { ok = false; break; }
        score += Math.min(c, 6);
      }
      if (!ok) continue;
      if (!P.clauses.length) score = 1;
      hits.push({ i, d, score: score / (1 + Math.log(1 + f.length / 700)) });
    }
  }
  const byDoc = new Map();
  for (const h of hits) { if (!byDoc.has(h.d.i)) byDoc.set(h.d.i, { d: h.d, hits: [], best: 0 }); const g = byDoc.get(h.d.i); g.hits.push(h); g.best = Math.max(g.best, h.score); }
  const groups = [...byDoc.values()];
  const by = sort || 'rel';
  hits.sort((a, b) => by === 'rel' ? (b.score - a.score) || (a.d.i - b.d.i) || (a.i - b.i) : by === 'new' ? (a.d.i - b.d.i) || (a.i - b.i) : (b.d.i - a.d.i) || (a.i - b.i));
  groups.forEach((g) => g.hits.sort((a, b) => by === 'rel' ? (b.score - a.score) || (a.i - b.i) : a.i - b.i));
  groups.sort((a, b) => by === 'rel' ? (b.best - a.best) || (b.hits.length - a.hits.length) || (a.d.i - b.d.i) : by === 'new' ? a.d.i - b.d.i : b.d.i - a.d.i);
  return { mode: 'paras', hits, groups, P };
}

export function citation(d, row) {
  const num = d.num.replace('App. Nos.', 'App Nos').replace('App. No.', 'App No');
  const type = d.t.charAt(0).toLowerCase() + d.t.slice(1);
  const at = row ? (row[1] != null ? `, para ${row[1]}` : `, p ${row[2]}`) : '';
  if (d.b === 'Court') return `${d.name}, ${num}, ${BODY.Court}, ${type}${d.d ? ' of ' + dtext(d) : ''}${at}.`;
  return `${d.name}, ${num}, ${BODY.Commission}, ${type}${d.y ? ' (' + d.y + ')' : ''}${at}${d.mt ? ' (unofficial machine translation from the French)' : ''}.`;
}

/* ---------- citation check (as on the website) ---------- */
const AU = ["Algeria", "Angola", "Benin", "Botswana", "Burkina Faso", "Burundi", "Cameroon", "Cabo Verde", "Cape Verde", "Central African Republic", "Chad", "Comoros", "Congo", "Democratic Republic of the Congo", "Democratic Republic of Congo", "DRC", "DR Congo", "Côte d'Ivoire", "Côte d’Ivoire", "Cote d'Ivoire", "Cote d’Ivoire", "Ivory Coast", "Djibouti", "Egypt", "Equatorial Guinea", "Eritrea", "Eswatini", "Swaziland", "Ethiopia", "Gabon", "Gambia", "Ghana", "Guinea", "Guinea-Bissau", "Kenya", "Lesotho", "Liberia", "Libya", "Madagascar", "Malawi", "Mali", "Mauritania", "Mauritius", "Morocco", "Mozambique", "Namibia", "Niger", "Nigeria", "Rwanda", "Sahrawi Arab Democratic Republic", "São Tomé and Príncipe", "Sao Tome and Principe", "Senegal", "Seychelles", "Sierra Leone", "Somalia", "South Africa", "South Sudan", "Sudan", "Tanzania", "Togo", "Tunisia", "Uganda", "Zambia", "Zimbabwe"];
const ST1 = "(?:the\\s+)?(?:(?:United|Federal\\s+Democratic|Federal|Arab|Islamic|Democratic)\\s+)?(?:Republic\\s+of\\s+(?:the\\s+)?|Kingdom\\s+of\\s+|State\\s+of\\s+)?(?:" + AU.slice().sort((a, b) => b.length - a.length).map(reEsc).join('|') + ")(?:\\s*\\(The\\))?";
const RESP = `${ST1}(?:\\s*,\\s*${ST1})*(?:\\s+(?:and|&)\\s+${ST1})?`;
const NTOK = "(?:\\p{Lu}[\\p{L}\\p{M}'’.\\-]*|\\(\\p{Lu}[\\p{L}\\p{M}'’.\\-]*\\)|and|of|for|on|behalf|the|de|des|du|la|le|et|&|al|el|ben|bin|Others|others)";
const CASE_RE = new RegExp(`(\\p{Lu}[\\p{L}\\p{M}'’.\\-]*(?:\\s+${NTOK})*?)\\s+v[s]?\\.?\\s+(${RESP})(?![\\p{L}])`, 'gu');
const COMM_RE = /\b(?:Communications?|Comms?\.|Comm\.)\s*(?:Nos?\.?\s*)?(\d{1,3}\s*\/\s*\d{2,4}(?:\s*(?:,|&|and|-|–)\s*\d{1,3}\s*\/\s*\d{2,4})*)/gi;
const COURT_RE = /\b(?:Applications?|Apps?\.?|Requêtes?)\s*(?:Nos?\.?|N[°o]s?\.?)?\s*(\d{3}\s*\/\s*\d{4}(?:\s*(?:,|&|and)\s*\d{3}\s*\/\s*\d{4})*)/gi;
const BARE_COURT = /(?<![\d/])(\d{3})\/((?:19|20)\d{2})(?![\d/])/g;
const SHORT_RE = /(\p{Lu}[\p{L}\p{M}'’-]+(?:\s+(?:and\s+Others|\p{Lu}[\p{L}\p{M}'’-]+))?)\s*(?:,\s*)?(?:cited\s+above|supra)/gu;
const LEAD = new Set('in see also cf cf. the compare as and but thus moreover however similarly following unlike under per since notably likewise indeed further furthermore although while when where whereas before after this that these those then here judgment case decision communication e.g. i.e. for by on at from with to there it its their our his her a an'.split(' '));

function nameScore(citedApp, d) {
  const t = nameTokens(citedApp); if (!t.length || !d.appTok.length) return 0;
  const set = new Set(d.appTok); return t.filter((w) => set.has(w)).length / t.length;
}
function stateOk(citedResp, d) {
  const r = fold(citedResp);
  return d.st.some((s) => r.includes(fold(s).split(' ')[0])) || d.respFold.split(/[^a-z]+/).some((w) => w.length > 3 && r.includes(w));
}

function findCitations(text) {
  const anchors = [], numSpans = [];
  for (const m of text.matchAll(CASE_RE)) {
    const words = m[1].split(/\s+/); let cut = 0;
    while (cut < words.length - 1 && LEAD.has(words[cut].toLowerCase().replace(/[(),]/g, ''))) cut++;
    const app = words.slice(cut).join(' ');
    anchors.push({ type: 'name', start: m.index + m[0].indexOf(app), end: m.index + m[0].length, app, resp: m[2] });
  }
  const addNums = (m, type) => {
    const nums = [...m[1].matchAll(/(\d{1,3})\s*\/\s*(\d{2,4})/g)].map((x) => type === 'court' ? `${x[1]}/${x[2]}` : `${+x[1]}/${x[2].slice(-2)}`);
    anchors.push({ type, start: m.index, end: m.index + m[0].length, nums }); numSpans.push([m.index, m.index + m[0].length]);
  };
  for (const m of text.matchAll(COMM_RE)) addNums(m, 'comm');
  for (const m of text.matchAll(COURT_RE)) addNums(m, 'court');
  for (const m of text.matchAll(BARE_COURT)) if (!numSpans.some(([a, b]) => m.index >= a && m.index < b)) anchors.push({ type: 'court', start: m.index, end: m.index + m[0].length, nums: [`${m[1]}/${m[2]}`] });
  for (const m of text.matchAll(SHORT_RE)) anchors.push({ type: 'short', start: m.index, end: m.index + m[0].length, key: m[1] });
  anchors.sort((a, b) => a.start - b.start);
  const units = [];
  for (const a of anchors) {
    const u = units[units.length - 1];
    if (u && a.type !== 'name' && a.type !== 'short' && a.start - u.end < 90 && !/[;]|\.\s+\p{Lu}/u.test(text.slice(u.end, a.start)) && (u.nums.length === 0 || u.type !== 'name')) {
      u.nums.push(...a.nums); u.end = a.end; u.kind = u.kind || a.type; continue;
    }
    if (u && a.start < u.end) continue;
    units.push({ start: a.start, end: a.end, app: a.app || null, resp: a.resp || null, nums: a.nums ? [...a.nums] : [], kind: a.type === 'name' ? null : a.type, short: a.key || null });
  }
  units.forEach((u, k) => {
    const nextStart = k + 1 < units.length ? units[k + 1].start : text.length;
    let tail = text.slice(u.end, Math.min(nextStart, u.end + 180));
    const stop = tail.search(/;|\n|\)\s*[.;,]?\s*$|\.\s+(?=\p{Lu})/u); if (stop >= 0) tail = tail.slice(0, stop + 1);
    u.end2 = u.end + tail.length;
    const pin = /(?:\bparas?\.?|\bparagraphs?|§§?)\s*(\d+)(?:\s*(?:-|–|to)\s*(\d+))?/i.exec(tail);
    let last = 0;
    for (const re of [/(?:\bparas?\.?|\bparagraphs?|§§?)\s*\d+(?:\s*(?:-|–|to)\s*\d+)?/i, /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/i,
      /\(\d{4}\)/, /\b(?:provisional measures|reparations?|merits|admissibility|jurisdiction|review|interpretation|(?:separate|dissenting) opinion)\b/i]) {
      const mm = re.exec(tail); if (mm && mm.index < 120) last = Math.max(last, mm.index + mm[0].length);
    }
    u.endShow = u.end + last;
    u.pins = pin ? Array.from({ length: Math.min(40, (pin[2] ? +pin[2] : +pin[1]) - +pin[1] + 1) }, (_, i) => +pin[1] + i) : [];
    const dm = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i.exec(tail);
    u.date = dm ? `${dm[3]}-${String(MONTHS.findIndex((x) => x.toLowerCase() === dm[2].toLowerCase()) + 1).padStart(2, '0')}-${dm[1].padStart(2, '0')}` : null;
    const ym = /\((\d{4})\)|\b(?:19|20)\d{2}\b/.exec(tail.replace(/\d{3}\/\d{4}/g, '')); u.year = dm ? +dm[3] : ym ? +(ym[1] || ym[0]) : null;
    u.kw = (/(provisional measures)/i.exec(tail) || /(reparations?)/i.exec(tail) || /(merits)/i.exec(tail) || /(admissibility|jurisdiction)/i.exec(tail) || /(review|interpretation)/i.exec(tail) || /(separate|dissenting) opinion/i.exec(tail) || [])[1] || null;
  });
  const quotes = [...text.matchAll(/[“"«]([^“”"«»]{12,800})[”"»]/g)].map((m) => ({ start: m.index, end: m.index + m[0].length, q: m[1] }));
  for (const q of quotes) {
    let best = null;
    for (const u of units) { if (u.start >= q.end && u.start - q.end < 400) { best = u; break; } }
    if (!best) for (let k = units.length - 1; k >= 0; k--) { const u = units[k]; if (u.end2 <= q.start && q.start - u.end2 < 150) { best = u; break; } }
    if (best) (best.quotes = best.quotes || []).push(q.q);
  }
  return units;
}

const words = (s) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);
function lcsLen(a, b) {
  const n = a.length, m = b.length; if (!n || !m) return 0;
  let prev = new Uint16Array(m + 1), cur = new Uint16Array(m + 1);
  for (let i = 1; i <= n; i++) { for (let j = 1; j <= m; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]); [prev, cur] = [cur, prev]; }
  return prev[m];
}
const pnum = (row) => (row[1] != null ? `para ${row[1]}` : `p. ${row[2]}`);
function quoteCheck(q, d, pins) {
  const frags = q.split(/\s*(?:\.\.\.|…|\[[^\]]*\])\s*/).map(words).filter((f) => f.length);
  if (!frags.length) return null;
  const qw = frags.flat();
  const rows = []; for (let i = d.s; i < d.s + d.c; i++) rows.push(i);
  const exactIn = (i) => { const w = words(C.PARAS[i][4]).join(' '); let pos = 0; for (const f of frags) { const k = w.indexOf(f.join(' '), pos); if (k < 0) return false; pos = k; } return true; };
  const pinRows = pins.length ? rows.filter((i) => pins.includes(C.PARAS[i][1])) : [];
  if (pinRows.some(exactIn)) return { st: 'ok', msg: 'quotation matches the text word for word' };
  const any = rows.find(exactIn);
  if (any !== undefined) return { st: pins.length ? 'warn' : 'ok', msg: pins.length ? `the quotation is in ${pnum(C.PARAS[any])}, not in para ${pins.join(', ')}` : `quotation matches ${pnum(C.PARAS[any])} word for word`, at: any };
  let best = null;
  for (const i of (pinRows.length ? pinRows : rows)) {
    const pw = words(C.PARAS[i][4]); if (pw.length > 1500) continue;
    const sc = lcsLen(qw, pw) / qw.length; if (!best || sc > best.sc) best = { sc, i };
  }
  if (best && best.sc >= 0.7) return { st: 'warn', msg: `the quotation differs from ${pnum(C.PARAS[best.i])} (${Math.round(best.sc * 100)}% of its words in order); the text there reads: "${C.PARAS[best.i][4].slice(0, 600)}${C.PARAS[best.i][4].length > 600 ? '…' : ''}"`, at: best.i };
  return { st: 'bad', msg: 'the quotation is not in this decision' };
}
const RANK = { bad: 5, warn: 4, amb: 3, out: 2, ok: 1 };
function resolve(u, units, compareQuotes) {
  const msgs = []; let st = 'ok', cands = [];
  if (u.short) {
    const key = fold(u.short).split(' ')[0];
    const prev = units.filter((x) => x !== u && x.start < u.start && x.doc && (fold(x.app || '').includes(key) || fold(x.doc.name).includes(key))).pop();
    if (!prev) return { st: 'amb', msgs: [`"${u.short}, cited above" - no earlier full citation with this name in the text`], cands: [] };
    cands = [prev.doc]; msgs.push(`refers to the earlier citation of ${prev.doc.name}`);
  } else if (u.nums.length) {
    for (const n of u.nums) {
      const hit = C.NUMIX[n];
      if (hit) cands.push(...hit.map((i) => C.DOCS[i]));
      else if (C.KNOWN[n]) { const [nm, why] = C.KNOWN[n]; return { st: 'out', msgs: [`${n} (${nm}) exists, but ${why === 'nodecision' ? 'the Court has published no decision in it that is in this database' : 'its text is not in this database'}`], cands: [] }; }
      else return { st: 'bad', msgs: [`no ${u.kind === 'court' || n.split('/')[1].length === 4 ? 'application' : 'communication'} ${n} in the records of the Commission or the Court`], cands: [] };
    }
    cands = [...new Set(cands)];
    if (u.app && cands.length && Math.max(...cands.map((d) => nameScore(u.app, d))) < 0.34) { st = 'warn'; msgs.push(`the name does not match the number: ${u.nums.join(', ')} is ${cands[0].name}`); }
  } else if (u.app) {
    cands = C.DOCS.filter((d) => !d.mt && nameScore(u.app, d) >= 0.6 && stateOk(u.resp, d));
    if (!cands.length) return { st: 'out', msgs: ['no decision of the Commission or the Court under this name here; it may be a decision of another body'], cands: [] };
  }
  let c = cands.slice();
  const opinion = u.kw && /opinion/i.test(u.kw);
  const f1 = c.filter((d) => opinion ? d.kind === 'opinion' : d.kind === 'decision'); if (f1.length) c = f1;
  if (u.date) { const f = c.filter((d) => d.d === u.date); if (f.length) c = f; else if (c.length) { if (RANK[st] < RANK.warn) st = 'warn'; msgs.push(`no decision of ${u.date} in this case; the dates here are ${[...new Set(c.map((d) => d.d || d.y))].join(', ')}`); } }
  else if (u.year) { const f = c.filter((d) => d.y === u.year); if (f.length) c = f; }
  if (u.kw && !opinion) { const f = c.filter((d) => fold(d.t).includes(fold(u.kw).replace(/s$/, ''))); if (f.length) c = f; }
  if (c.length > 1 && u.pins.length) { const f = c.filter((d) => { for (let i = d.s; i < d.s + d.c; i++) if (u.pins.includes(C.PARAS[i][1])) return true; return false; }); if (f.length) c = f; }
  if (c.length > 1 && u.quotes) { const f = c.filter((d) => { const r = quoteCheck(u.quotes[0], d, []); return r && r.st !== 'bad'; }); if (f.length) c = f; }
  if (c.length > 1) { const merits = c.filter((d) => /merits/i.test(d.t)); if (merits.length === 1 && !u.kw) { c = merits; msgs.push('several decisions in this case; taken as the decision on the merits'); } }
  if (c.length > 1) return { st: 'amb', msgs: [`${c.length} decisions match; add the date or the kind of decision`, ...msgs], cands: c };
  if (!c.length) return { st: 'bad', msgs: ['no decision matches'], cands: [] };
  const d = c[0]; u.doc = d;
  const out = { st, msgs, cands: c, doc: d };
  if (u.pins.length) {
    const ns = new Set(); for (let i = d.s; i < d.s + d.c; i++) if (C.PARAS[i][1] != null) ns.add(C.PARAS[i][1]);
    const missing = u.pins.filter((p) => !ns.has(p));
    if (d.un) msgs.push('this decision has no numbered paragraphs');
    else if (missing.length) { if (RANK[out.st] < RANK.warn) out.st = 'warn'; msgs.push(`para ${missing.join(', ')} does not exist: the decision has paragraphs 1–${Math.max(...ns)}`); }
    else msgs.push(`para ${u.pins.length > 1 ? u.pins[0] + '–' + u.pins[u.pins.length - 1] : u.pins[0]} exists`);
  }
  if (u.quotes && compareQuotes) {
    out.qres = u.quotes.map((q) => quoteCheck(q, d, u.pins)).filter(Boolean);
    for (const r of out.qres) if (RANK[r.st] > RANK[out.st]) out.st = r.st;
  }
  return out;
}
export function checkText(text, compareQuotes = true) {
  const units = findCitations(text);
  return units.map((u) => ({ cited: text.slice(u.start, u.endShow).replace(/\s+/g, ' ').trim().replace(/[\s,;(]+$/, ''), u, r: resolve(u, units, compareQuotes) }));
}
