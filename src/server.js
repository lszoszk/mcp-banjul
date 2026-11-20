/**
 * mcp-banjul shared server factory (used by index.js = stdio and http.js = Streamable HTTP).
 *
 * Tools over Banjul Researcher (https://lszoszk.github.io/banjul-researcher/): paragraph-level search over the
 * decisions of the African Commission and the judgments, rulings, orders and separate opinions of the African Court
 * on Human and Peoples' Rights, the text of a decision, a citation check, and the filter vocabulary. Every result is
 * the VERBATIM text of the decision with a citation and a link to the PDF page, so any quotation can be checked.
 *
 * Config (env): DATA_BASE (default https://lszoszk.github.io/banjul-researcher/), REFRESH_HOURS (6).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { C, ready, search, citation, checkText, dtext, BODY, DATA_BASE } from './engine.js';

export const config = { DATA_BASE };
const ok = (text) => ({ content: [{ type: 'text', text }] });
const errResult = (text) => ({ content: [{ type: 'text', text }], isError: true });
const app = (d) => `${DATA_BASE}#doc-${d.id}`;
const pdf = (d, page) => d.url + (page ? `#page=${page}` : '');
const where = (row) => (row[1] != null ? `para ${row[1]}` : `page ${row[2]}`);

const SOURCE_NOTE =
  "Corpus: decisions of the African Commission on Human and Peoples' Rights (from its library) and English judgments, rulings, orders and separate opinions of the African Court on Human and Peoples' Rights (from AJUDATA), split into their numbered paragraphs. Scanned decisions were read by OCR: check the PDF before quoting. ";

function metaLine(d) {
  return [d.au || d.t, d.num, d.st.join(', '), d.d ? dtext(d) : d.y, d.lang === 'fr' && !d.mt ? 'in French' : null,
    d.mt ? 'UNOFFICIAL MACHINE TRANSLATION from the French' : null].filter(Boolean).join(' · ');
}
function findingsLine(d) {
  const f = [];
  const ev = (c) => (d.ev && d.ev[c] != null ? ` (para ${d.ev[c]})` : '');
  if (d.v.length) f.push(`violation: ${d.v.map((c) => c + ev(c)).join(', ')}`);
  if (d.nv.length) f.push(`no violation: ${d.nv.map((c) => c + ev(c)).join(', ')}`);
  const al = (d.al || []).filter((c) => !d.v.includes(c) && !d.nv.includes(c));
  if (al.length) f.push(`alleged, not decided: ${al.join(', ')}`);
  const how = d.fs === 'reader' ? 'read from the whole decision by a language model, with the paragraph each rests on' : 'extracted from the operative part';
  return f.length ? `findings (${how}) and allegations, a research aid: ${f.join('; ')}` : null;
}

const filterSchema = {
  body: z.enum(['Commission', 'Court']).optional().describe('Only the African Commission or only the African Court.'),
  state: z.string().optional().describe('Respondent State, e.g. Tanzania, Kenya, "Côte d\'Ivoire".'),
  judge: z.string().optional().describe('Separate opinions and declarations by a judge of the Court (surname), e.g. "Ben Achour", "Niyungeko", "Bensaoula".'),
  year_from: z.number().int().optional(),
  year_to: z.number().int().optional(),
  type: z.array(z.string()).optional().describe('Kinds of decision (substring match), e.g. ["merits"], ["provisional measures"], ["admissibility"], ["separate opinion"].'),
  article: z.string().optional().describe('An article with a finding, e.g. "7" (African Charter), "ICCPR-14", "Maputo-4", "ACDEG-17".'),
  finding: z.enum(['any', 'violation', 'no_violation', 'alleged']).default('any').describe('With article: violation found, no violation found, either, or alleged (claimed by the complainant or ruled on).'),
  operative_only: z.boolean().default(false).describe('Search only the operative parts.'),
  include_opinions: z.boolean().default(true).describe('Include separate opinions of the Court.'),
  include_translations: z.boolean().default(false).describe('Include the unofficial English machine translations of the 47 French-only Commission decisions.'),
};
const toFilter = (a) => ({
  body: a.body, state: a.state, judge: a.judge, year_from: a.year_from, year_to: a.year_to, types: a.type, article: a.article, finding: a.finding || 'any',
  operative_only: a.operative_only, opinions: a.include_opinions !== false, decisions: true, translations: !!a.include_translations,
});

export function buildServer() {
  const server = new McpServer({ name: 'mcp-banjul', version: '1.0.0' });

  server.registerTool('banjul_search', {
    title: 'Search the African Commission and Court (paragraph level)',
    description: SOURCE_NOTE +
      'Full-text search over paragraphs. Query syntax as on the website: words must all appear in one paragraph; "exact phrase"; OR between alternatives; NOT word or -word; prefix* (at least 3 letters); field operators violation:7, nonviolation:2, article:7, alleged:7 (Charter; other instruments as violation:ICCPR-14), state:Kenya, case:245/02 or case:005/2013, judge:"Ben Achour" (separate opinions by a judge), cites:155/96 or cites:"Alex Thomas" (decisions citing a decision), year:2015-2020, body:court. Accents and capitals are ignored. An empty query lists decisions (newest first) matching the filters. Returns, for each hit, a citation with the paragraph number, the VERBATIM paragraph, the decision metadata and findings, the doc_id for banjul_get_decision, and links to the PDF page and to the website.',
    inputSchema: {
      query: z.string().default('').describe('e.g. "free legal assistance" violation:7, indigen* "ancestral land", expulsion state:Angola.'),
      group: z.enum(['decision', 'paragraph']).default('paragraph').describe('paragraph = best paragraphs across decisions; decision = one entry per decision with its best paragraphs.'),
      sort: z.enum(['rel', 'new', 'old', 'cited']).optional().describe('rel = relevance (default with words), new = newest first, old = oldest first, cited = most cited by other decisions first (leading cases).'),
      limit: z.number().int().min(1).max(50).default(10),
      offset: z.number().int().min(0).default(0),
      ...filterSchema,
    },
  }, async (a) => {
    try {
      await ready();
      const r = search(a.query, toFilter(a), a.sort || (a.query.trim() ? 'rel' : 'new'));
      const L = [];
      if (r.P.notes.length) L.push(`Note: ${r.P.notes.join('; ')}.`, '');
      if (r.mode === 'docs') {
        L.push(`${r.docs.length} decisions match (no search words, so decisions are listed). Showing ${r.docs.length ? a.offset + 1 : 0}–${Math.min(r.docs.length, a.offset + a.limit)}.`, '');
        r.docs.slice(a.offset, a.offset + a.limit).forEach((d, k) => {
          L.push(`${a.offset + k + 1}. ${citation(d, null)}`, metaLine(d));
          const f = findingsLine(d); if (f) L.push(f);
          L.push(`[doc_id: ${d.id} · ${d.c} paragraphs · PDF ${d.url} · ${app(d)}]`, '');
        });
        return ok(L.join('\n'));
      }
      const list = a.group === 'decision' ? r.groups : r.hits;
      L.push(`${r.hits.length} paragraphs in ${r.groups.length} decisions. Showing ${a.group === 'decision' ? 'decisions' : 'paragraphs'} ${list.length ? a.offset + 1 : 0}–${Math.min(list.length, a.offset + a.limit)} of ${list.length}.`, '');
      list.slice(a.offset, a.offset + a.limit).forEach((x, k) => {
        const hs = a.group === 'decision' ? x.hits.slice(0, 3) : [x];
        const d = x.d;
        L.push(`${a.offset + k + 1}. ${citation(d, a.group === 'decision' ? null : C.PARAS[x.i])}`, metaLine(d));
        const f = findingsLine(d); if (f) L.push(f);
        if (a.group === 'decision' && x.hits.length > 3) L.push(`${x.hits.length} matching paragraphs in this decision; the best 3:`);
        for (const h of hs) {
          const row = C.PARAS[h.i], head = C.HEADS[row[3]];
          L.push(`— ${where(row)}${head ? ` [section: ${head}]` : ''}${d.op >= 0 && h.i >= d.s + d.op ? ' [operative part]' : ''}: ${row[4]}`);
        }
        L.push(`[doc_id: ${d.id} · PDF page ${C.PARAS[hs[0].i][2]}: ${pdf(d, C.PARAS[hs[0].i][2])} · ${app(d)}]`, '');
      });
      if (!list.length) L.push('No paragraph matches. Drop a word, use OR or a prefix*, or widen the filters.');
      return ok(L.join('\n'));
    } catch (e) { return errResult(`banjul_search failed: ${e.message}`); }
  });

  server.registerTool('banjul_get_decision', {
    title: 'Get a decision: metadata, findings and verbatim paragraphs',
    description: SOURCE_NOTE + 'Full record of one decision by doc_id (from banjul_search): metadata, findings, separate opinions or the decision an opinion belongs to, the decisions it cites and that cite it (with paragraphs), and the VERBATIM paragraphs, optionally a range of paragraph numbers or the operative part only. Long decisions are returned in pages of at most 80 paragraphs: use from_para.',
    inputSchema: {
      doc_id: z.string().describe('e.g. AfCHPR-D604 or ACHPR-ohebxf4guq-0'),
      from_para: z.number().int().optional().describe('First paragraph number to return.'),
      to_para: z.number().int().optional().describe('Last paragraph number to return.'),
      operative_only: z.boolean().default(false),
    },
  }, async (a) => {
    try {
      await ready();
      const d = C.BY_ID[a.doc_id];
      if (!d) return errResult(`No decision with doc_id ${a.doc_id}. Use banjul_search to find one.`);
      const L = [citation(d, null), BODY[d.b], metaLine(d)];
      if (d.sess) L.push(`session: ${d.sess}`);
      const f = findingsLine(d); if (f) L.push(f);
      if (d.mt && C.BY_ID[d.orig]) L.push(`This is an UNOFFICIAL machine translation. Quote the French original: doc_id ${d.orig}.`);
      if (d.tr) L.push(`An unofficial English machine translation exists: doc_id ${d.tr}.`);
      if (d.dec && C.BY_ID[d.dec]) L.push(`Separate opinion on: ${citation(C.BY_ID[d.dec], null)} (doc_id ${d.dec})`);
      const ops = (C.OPS_OF[d.id] || []).map((i) => C.DOCS[i]);
      if (ops.length) L.push(`Separate opinions: ${ops.map((o) => `${o.au || o.t} (doc_id ${o.id})`).join('; ')}`);
      const lab = (o, k) => { const row = C.PARAS[o.s + k]; return row ? (row[1] != null ? `para ${row[1]}` : `p. ${row[2]}`) : ''; };
      const short = (o) => `${o.name}, ${o.t.toLowerCase()}${o.y ? ', ' + o.y : ''} (doc_id ${o.id})`;
      if (d.ct && d.ct.length) L.push(`Cites ${d.ct.length} decision(s) of the Commission or the Court (found automatically): ${d.ct.slice(0, 40).map(([b, ks]) => `${short(C.DOCS[b])} in ${ks.map((k) => lab(d, k)).join(', ')}`).join('; ')}${d.ct.length > 40 ? '; …' : ''}`);
      if (d.cb && d.cb.length) L.push(`Cited by ${d.cb.length} decision(s) (found automatically): ${d.cb.slice(0, 40).map(([a, ks]) => `${short(C.DOCS[a])} at ${ks.map((k) => lab(C.DOCS[a], k)).join(', ')}`).join('; ')}${d.cb.length > 40 ? '; …' : ''}`);
      L.push(`PDF: ${d.url} · website: ${app(d)} · text from ${d.src === 'ocr' ? 'OCR of a scan' : "the PDF's text layer"}`, '');
      const opOnly = a.operative_only && d.op >= 0;
      if (a.operative_only && d.op < 0) L.push('No operative part was detected in this decision; all paragraphs follow.');
      const rows = [];
      for (let i = d.s; i < d.s + d.c; i++) {
        const row = C.PARAS[i];
        if (opOnly && i < d.s + d.op) continue;
        if (a.from_para != null && row[1] != null && row[1] < a.from_para) continue;
        if (a.to_para != null && row[1] != null && row[1] > a.to_para) continue;
        rows.push(i);
      }
      const shown = rows.slice(0, 80);
      let lastHead = -1;
      for (const i of shown) {
        const row = C.PARAS[i];
        if (d.op >= 0 && i === d.s + d.op) L.push('--- operative part ---');
        if (row[3] && row[3] !== lastHead) { L.push(`[section: ${C.HEADS[row[3]]}]`); lastHead = row[3]; }
        L.push(`${where(row)} (PDF p. ${row[2]}): ${row[4]}`);
      }
      if (rows.length > shown.length) L.push('', `${rows.length - shown.length} more paragraphs: call again with from_para = ${C.PARAS[rows[shown.length]][1] ?? 'the next number'}.`);
      return ok(L.join('\n'));
    } catch (e) { return errResult(`banjul_get_decision failed: ${e.message}`); }
  });

  server.registerTool('banjul_check', {
    title: 'Check citations of the African Commission and Court in a text',
    description: SOURCE_NOTE + 'Finds the citations in a text (communication numbers "Communication 245/02", application numbers "Application No. 005/2013", names "X v State", "X, cited above") and checks each: does the number exist and match the name, which decision of the case is meant (by date, year or kind), does the pinpointed paragraph exist, and does a quotation next to the citation match the decision word for word. Status per citation: ok, warn (check it), bad (not found), amb (ambiguous), out (outside this database, e.g. ECOWAS Court). Use it on your own draft answer before giving it.',
    inputSchema: {
      text: z.string().min(1).describe('The text to check (up to about 30,000 characters).'),
      compare_quotes: z.boolean().default(true),
    },
  }, async (a) => {
    try {
      await ready();
      const res = checkText(a.text.slice(0, 30000), a.compare_quotes);
      if (!res.length) return ok('No citation of the African Commission or Court found. The check looks for communication and application numbers and for names in the form "X v State".');
      const cnt = { ok: 0, warn: 0, bad: 0, amb: 0, out: 0 }; res.forEach((x) => cnt[x.r.st]++);
      const L = [`${res.length} citations: ${cnt.ok} ok, ${cnt.warn} to check, ${cnt.bad} not found, ${cnt.amb} ambiguous, ${cnt.out} outside this database.`, ''];
      res.forEach(({ cited, r }, k) => {
        L.push(`${k + 1}. [${r.st}] ${cited}`);
        if (r.doc) L.push(`   → ${citation(r.doc, null)} (doc_id ${r.doc.id})`);
        r.msgs.forEach((m) => L.push(`   - ${m}`));
        (r.qres || []).forEach((q) => L.push(`   - [${q.st}] ${q.msg}`));
        if (r.st === 'amb' && r.cands.length) r.cands.slice(0, 6).forEach((c) => L.push(`   · candidate: ${c.t}, ${c.d ? dtext(c) : c.y} (doc_id ${c.id})`));
      });
      L.push('', 'A citation marked ok has been matched, not proofread: read the paragraph before relying on it.');
      return ok(L.join('\n'));
    } catch (e) { return errResult(`banjul_check failed: ${e.message}`); }
  });

  server.registerTool('banjul_facets', {
    title: 'Corpus figures and filter values',
    description: SOURCE_NOTE + 'Corpus size and the values the filters of banjul_search accept: bodies, kinds of decision, respondent States, articles with findings (with counts), the most cited decisions, judges who wrote separate opinions, years.',
    inputSchema: {},
  }, async () => {
    try {
      await ready();
      const docs = C.DOCS.filter((d) => !d.mt);
      const cnt = (key) => { const m = {}; docs.forEach((d) => [].concat(key(d)).forEach((v) => { if (v) m[v] = (m[v] || 0) + 1; })); return Object.entries(m).sort((x, y) => y[1] - x[1]); };
      const ys = docs.map((d) => d.y).filter(Boolean);
      const L = [
        `Corpus built ${C.INFO.built}: ${docs.length} documents with ${docs.reduce((n, d) => n + d.c, 0).toLocaleString('en')} paragraphs, plus unofficial English machine translations of ${C.INFO.mt || 0} French-only Commission decisions; years ${Math.min(...ys)}–${Math.max(...ys)}. Data loaded ${C.loadedAt.toISOString()}.`,
        '', 'body: ' + cnt((d) => d.b).map(([k, n]) => `${k} (${n})`).join(', '),
        '', 'type: ' + cnt((d) => `${d.b}: ${d.t}`).map(([k, n]) => `${k} (${n})`).join('; '),
        '', 'state: ' + cnt((d) => d.st).map(([k, n]) => `${k} (${n})`).join(', '),
        '', 'article (decisions with a finding; Charter unless named): ' + cnt((d) => [...d.codes]).map(([k, n]) => `${k.replace(/^Charter /, '')} (${n})`).join(', '),
        '', 'most cited (decisions citing them): ' + docs.filter((d) => d.ncb).sort((a, b) => b.ncb - a.ncb).slice(0, 15).map((d) => `${d.name}, ${d.t.toLowerCase()}, ${d.y} [${d.id}] (${d.ncb})`).join('; '),
        '', 'judge (separate opinions and declarations of the Court): ' + cnt((d) => (d.aus ? d.aus.split(' · ')[1].split(', ') : [])).map(([k, n]) => `${k} (${n})`).join(', '),
      ];
      return ok(L.join('\n'));
    } catch (e) { return errResult(`banjul_facets failed: ${e.message}`); }
  });

  return server;
}
