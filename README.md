# mcp-banjul

Model Context Protocol server for **Banjul Researcher**
(https://lszoszk.github.io/banjul-researcher/): paragraph-level search over the decisions of the African
Commission on Human and Peoples' Rights and the judgments, rulings, orders and separate opinions of the African
Court on Human and Peoples' Rights, with each paragraph's case name, communication or application number,
date and paragraph number, plus a citation check.

The server loads the same data as the website (`docs.json` and the paragraph files published on GitHub Pages)
and runs the same search, so an assistant and the website return the same results. Every result is the
**verbatim** text of the decision, so answers stay citable to the paragraph.

## Tools

| Tool | Purpose |
|---|---|
| `banjul_search` | Paragraph-level full-text search: phrases, `OR`, `NOT`, `prefix*`, `violation:7`, `article:ICCPR-14`, `state:`, `case:`, `judge:`, `year:`, `body:`; filters for body, State, judge (separate opinions), years, kind of decision, article and finding, operative part only, separate opinions, machine translations |
| `banjul_get_decision` | Metadata, extracted findings, separate opinions and the verbatim paragraphs of one decision (by paragraph range or the operative part) |
| `banjul_check` | Finds the citations of the Commission and the Court in a text and checks the number, the name, the pinpointed paragraph and the quotation |
| `banjul_facets` | Corpus size and the values the filters accept, including the judges who wrote separate opinions |

## Hosted connector (nothing to install)

**https://150.254.115.204/banjul-mcp/mcp** – Streamable HTTP, no token.

- Claude (claude.ai / Desktop): Settings → Connectors → Add custom connector → paste the address.
- Claude Code: `claude mcp add --transport http banjul https://150.254.115.204/banjul-mcp/mcp -s user`

## Run it yourself

```bash
npm install
node index.js          # stdio, for Claude Desktop or Claude Code
node http.js           # Streamable HTTP on 127.0.0.1:8015/mcp
npm test               # smoke test against the published data
```

`DATA_BASE` points to another copy of the published data; `REFRESH_HOURS` (default 6) sets how often it is reloaded.

## Notes

Scanned decisions were read by OCR, and the findings of violation are extracted automatically from the
operative parts: read the paragraph and the PDF before relying on either. The machine translations of
French-only Commission decisions are unofficial and are left out unless `include_translations` is set.

Licence: PolyForm Noncommercial 1.0.0. The decisions are the work of the African Commission and the
African Court; this project is not affiliated with or endorsed by either body.
