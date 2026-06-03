# Deep Research

How Jarvis should support **"deeply research X"** — e.g. theories for Dana's psychiatric symptoms, or evaluating ketosis as a treatment. This doc captures the landscape we explored, the decision, and the implementation plan.

See also: [workflow-medical-research.md](workflow-medical-research.md) (the gaps this closes) and [workflow-research.md](workflow-research.md) (the original multi-round research sketch).

---

## TL;DR — the decision

Jarvis will **not** autonomously burn tokens on multi-round research. Instead it runs a **human-in-the-loop hand-off + archival loop**: Jarvis assembles an excellent *adversarial research brief* from knowledge-graph context, the user runs it in their already-subsidized Deep Research subscription (Claude.ai / Gemini / ChatGPT), and then Jarvis **ingests the returned report** — archiving it permanently (searchable forever via `search_archives`) and storing a single summary fact in the knowledge graph.

- **Cost:** ~$0 marginal (rides the existing subscription). No new paid dependencies.
- **Sources:** only what Jarvis already has (Anthropic server-side `web_search`, for light scoping).
- **Build:** one **skill** (instructions) + one small **tool** (the only missing primitive) + a source-type + a migration. No background jobs.

This closes the exact gap [workflow-medical-research.md](workflow-medical-research.md) identified: research results today are **ephemeral** (they live only in conversation history, truncated at ~20k tokens), there is **no archival** of findings, and **no multi-round** capability (`web_search` is capped at 5/turn in [toolRegistry.ts:27](src/tools/toolRegistry.ts)).

---

## Why not autonomous? The root constraint

Jarvis is a **single-threaded, synchronous event loop** ([runEventLoop.ts](src/engine/runEventLoop.ts), [processEvent.ts](src/engine/processEvent.ts)) with no background execution. A turn blocks until the tool loop finishes (capped at 50 iterations, [handleToolUseResponse.ts](src/engine/handleToolUseResponse.ts)), `web_search` is capped at 5/turn, output is 4096 tokens, and the `events` table has no scheduler firing it yet. So "spend millions of tokens over many rounds, then archive a report" **cannot run inside one Telegram turn** — it would require a background job runner we've chosen not to build (yet).

Offloading the heavy lifting to a human-driven, subsidized Deep Research session sidesteps the entire async-infrastructure problem while still delivering durable, recallable research.

---

## The landscape we considered

| Approach | What Jarvis does | Build cost | $/task |
|---|---|---|---|
| **Human-in-the-loop** ✅ *(chosen)* | Assembles KG context + adversarial brief; user runs it externally; pastes/uploads the report back to archive | Low | ~$0 (subscription) |
| **External engine as a tool** | Calls a turnkey deep-research API and archives the result | Low–med | pay-per-use |
| **Fully autonomous** | Runs its own orchestrator→search→synthesize→teardown→judge loop | High (needs background jobs) | ~$30–115 |

The autonomous option maps onto **Anthropic's own orchestrator-worker pattern** (lead agent spawns parallel subagents) — but their published numbers are sobering: multi-agent research burns **~15× the tokens** of a normal chat, and token spend alone explained ~80% of quality variance. Open-source frameworks in this space: [LangChain Open Deep Research](https://github.com/langchain-ai/open_deep_research) (supervisor + sub-agents, MIT), [dzhng/deep-research](https://github.com/dzhng/deep-research) (recursive, <500 LoC, MIT), [GPT Researcher](https://github.com/assafelovic/gpt-researcher) (+ [gptr-mcp](https://github.com/assafelovic/gptr-mcp)), [HuggingFace smolagents Open Deep Research](https://huggingface.co/blog/open-deep-research) (#1 GAIA), [local-deep-research](https://github.com/LearningCircuit/local-deep-research). Turnkey engines: Perplexity `sonar-deep-research`, OpenAI `o3-deep-research`, Gemini Deep Research.

---

## MCP servers & sources (catalog)

We are **not** wiring these in for the chosen approach, but cataloging them here since the question ("are there MCP servers out there?") will recur for phase-2. The Anthropic API's **[MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)** lets Jarvis attach *remote* MCP servers without writing MCP clients in Deno.

**Web search / retrieval (research-grade):**
- [Exa MCP](https://github.com/exa-labs/exa-mcp-server) — neural/semantic search + content extraction.
- [Tavily MCP](https://github.com/tavily-ai/tavily-mcp) — LLM-optimized search/extract/crawl.
- [Linkup](https://github.com/LinkupPlatform/linkup-mcp-server), [Brave Search MCP](https://github.com/brave/brave-search-mcp-server), [Kagi MCP](https://github.com/kagisearch/kagimcp), [Perplexity MCP](https://github.com/perplexityai/modelcontextprotocol) (incl. `sonar-deep-research`).

**Crawling / page extraction:**
- [Firecrawl MCP](https://github.com/firecrawl/firecrawl-mcp-server) — scrape→markdown/JSON, crawl, structured extraction.
- **[ScrapeGraphAI](https://scrapegraphai.com/)** — open-source (26.5k★) + hosted; [MCP server](https://github.com/scrapegraphai/scrapegraph-mcp) with `Scrape`/`Extract`/`Search`/`Crawl`/`Markdownify`. Free 500 credits/mo, then $17+/mo. Good "extract structured JSON from pages" peer to Firecrawl.
- [Crawl4AI](https://github.com/walksoda/crawl-mcp), [Jina Reader](https://github.com/jina-ai/MCP), [Playwright MCP](https://github.com/microsoft/playwright-mcp) (browser automation).

**Medical / academic (all free APIs, most have MCP servers)** — directly relevant to the Dana/keto use cases:
- [PubMed/NCBI MCP](https://github.com/JackKuo666/PubMed-MCP-Server) ([Anthropic's PubMed connector](https://claude.com/resources/tutorials/using-the-pubmed-connector-in-claude)), [Europe PMC](https://europepmc.org/api) (incl. medRxiv/bioRxiv), [Semantic Scholar API](https://www.semanticscholar.org/product/api) (free, 214M papers), [OpenAlex](https://openalex.org/) ([MCP](https://github.com/oksure/openalex-research-mcp)), [arXiv](https://info.arxiv.org/help/api/index.html), [ClinicalTrials.gov](https://clinicaltrials.gov/data-api/api).
- Citation-context tools: [Scite](https://www.scite.ai/), [Consensus](https://consensus.app/), [Elicit](https://elicit.org/).

---

## A caveat on rigor (the adversarial structure, done right)

The user's instinct — *build the strongest theory, then tear it down, then judge* — is sound, **but** the 2025 literature shows naive multi-agent debate often makes accuracy **worse** ([*Talk Isn't Always Cheap*, ICML 2025](https://arxiv.org/pdf/2509.05396)): agents drift toward agreement (sycophancy), and a confident-but-wrong side wins. It helps only with:
- **Role separation** with an explicit incentive for the critic to *refute* (not be charitable),
- **Chain-of-verification** per load-bearing claim ([CoVe](https://arxiv.org/pdf/2309.11495)),
- A **stronger judge** weighing *evidence quality, not volume*, and
- Source-quality discipline (peer-reviewed / primary over SEO'd secondary).

These safeguards are baked into the brief template below, rather than a free-form debate.

---

## Cost economics (why subscription wins here)

2026 API pricing (per MTok): Opus ~$5/$25, Sonnet ~$3/$15, Haiku ~$1/$5. An autonomous ~3M-token research task ≈ **$67 (Sonnet)** / **$112 (Opus)** uncached, or **~$30–40 with prompt caching**. A Claude.ai/Gemini **Max** subscription is **$100–200/mo flat** and includes Deep Research. Breakeven is only ~2–3 autonomous tasks/month — and the human-in-the-loop path costs **~$0 marginal** on top of a subscription the user already pays for. For a single user doing occasional deep dives, subscription + hand-off is clearly cheapest.

---

## Chosen approach — implementation plan

The feature is overwhelmingly a **skill** (instructions Claude follows using existing tools) plus **one small new tool** (the only genuinely missing primitive: archiving a text blob Claude holds). No background jobs, no new external services.

```
"deeply research X"
   → fetch_skill(deep_research) → query_knowledge (KG context) → [optional 1–2 web_search to scope]
   → reply with a structured adversarial BRIEF the user pastes into their Deep Research tool
            ⟂ (user runs it externally, gets a long markdown report)
user sends report back (uploaded .md/.txt/.pdf  ·or·  pasted)
   → fetch_skill(deep_research) Phase B → archive_research_report(title, markdown) → remember(1 summary fact)
   → confirm + surface headline.  Later: search_archives(source_type:"research_report") or query_knowledge.
```

### Why it fits the existing code

- **Archival of arbitrary text already works.** [archiveFile](src/archive/archiveFile.ts) takes `sourceType: string` (it already accepts the non-enum `"ocr_text"`, [handleDocumentMessage.ts:77](src/telegram/handleDocumentMessage.ts)); [embedArchivedFile](src/archive/embedArchivedFile.ts) chunks + embeds into `document_chunks`, searchable via [searchArchives](src/archive/searchArchives.ts).
- **Facts already work.** [storeFact](src/knowledge/storeFact.ts) / `remember` handle fuzzy entity resolution, supersession, and semantic dedup — reuse them for the one summary fact.
- **Skills are discovered from the DB into the prompt automatically** ([buildSystemPrompt.ts:90-108](src/prompt/buildSystemPrompt.ts)); the body is loaded on demand via `fetch_skill` ([skillTool.ts](src/tools/skillTool.ts)). The base prompt already says *"do NOT aggressively remember general research content"* ([buildSystemPrompt.ts:18](src/prompt/buildSystemPrompt.ts)) — the skill aligns with that by storing only one summary fact.

### Files to create / modify

**1. Add the source type — [src/archive/sourceTypes.ts](src/archive/sourceTypes.ts)**
Append `"research_report"` to the `SOURCE_TYPES` tuple. It's the documented single source of truth, so it propagates automatically to `embedArchivedFile`'s `SourceType` union, the `search_archives` filter validation, and the tool schema Claude sees.

**2. New tool `archive_research_report` — two new files** (single responsibility: archive + embed)
- `src/archive/archiveResearchReportSchema.ts` — Valibot input schema: `title` (nonEmpty), `markdown` (nonEmpty), `related_entity` (optional) + inferred type.
- `src/archive/archiveResearchReportTool.ts` — `ToolDefinition` ([toolTypes.ts](src/tools/toolTypes.ts) shape). Handler (~40 lines):
  1. `parseToolInput(...)`.
  2. `const fileBytes = new TextEncoder().encode(markdown).buffer as ArrayBuffer`.
  3. `archiveFile({ fileBytes, sourceType: "research_report", label: slug(title), ext: "md", mimeType: "text/markdown", originalFilename: `${slug(title)}.md`, metadata: { title, related_entity } })`.
  4. `embedArchivedFile({ archivedFileId, sourceType: "research_report", text: markdown, metadata: { title, related_entity } })`.
  5. Return a success `ToolResult`.

  `slug()` is a small non-exported helper in the same file (precedent: `extensionFromMime`, [handleDocumentMessage.ts:128](src/telegram/handleDocumentMessage.ts)). The summary **fact is stored separately by the skill via `remember`** — keeps the tool single-purpose and reuses `remember`'s entity-create-then-fact batching.

**3. Register the tool — [src/tools/toolRegistry.ts](src/tools/toolRegistry.ts)**
Import `archiveResearchReportTool` and append to the `toolDefinitions` array.

**4. Seed the skill — `migrations/010_deep_research_skill.sql`** (next number; applied in filename-sort order by `make migrate`)
Idempotent upsert so editing the body is safe:
```sql
INSERT INTO skills (name, description, body) VALUES
('deep_research',
 'Two-phase deep-research hand-off. Phase A: when the user asks to deeply research a topic, assemble a structured adversarial research brief for them to run in their external Deep Research tool. Phase B: when they bring the report back (pasted or uploaded), ingest it — archive it and store a one-line summary fact.',
 $$<SKILL BODY BELOW>$$)
ON CONFLICT (name) DO UPDATE
  SET description = EXCLUDED.description, body = EXCLUDED.body, updated_at = now();
```

**5. (Recommended) Clean `.md`/`.txt` upload — [src/telegram/handleDocumentMessage.ts](src/telegram/handleDocumentMessage.ts)**
Long reports paste unreliably (Telegram splits >4096 chars into separate queue events; history truncates at 20k tokens), so **file upload is the robust path.** `.pdf` already archives + embeds (via Mistral OCR — wasteful for already-text, tagged `document`), but `.md`/`.txt` are silently dropped by the `OCR_MIME_TYPES` gate ([handleDocumentMessage.ts:31](src/telegram/handleDocumentMessage.ts)). Add a branch *before* that gate: for `text/plain`/`text/markdown`, skip OCR, decode UTF-8, `archiveFile` + `embedArchivedFile`, and push `[Document: filename]\n<text>` to the queue. Separable from the core; without it, paste + PDF upload still work.

### The `deep_research` skill body

```text
# Deep Research

A two-phase, human-in-the-loop workflow. You do NOT run multi-round research yourself — the
heavy research happens in the user's external Deep Research tool (Claude.ai / Gemini / ChatGPT).
You (A) produce an excellent brief to paste in, and later (B) ingest the report they bring back.

Which phase: the user is ASKING you to research something → Phase A. The user is HANDING YOU a
finished report (long pasted markdown, or an uploaded .md/.txt/.pdf whose text you now see) → Phase B.

## Phase A — Assemble the brief
1. Gather context first: query_knowledge for what you already know about the subject and any
   entity it concerns (use include_all_facts: true when it centers on one person).
2. Optionally spend 1–2 web_search calls ONLY to frame good sub-questions and surface
   authoritative sources — do not try to answer the question here.
3. Reply with a single block the user can paste verbatim into their Deep Research tool:

   # Research brief: <core question in one sentence>
   ## Core question
   <precise, scoped question>
   ## Known context (treat as given; don't re-derive)
   <bullets of the relevant facts you already hold — names, dates, diagnoses, prior results>
   ## Angles to investigate
   <3–6 concrete sub-questions derived from the context>
   ## Method — adversarial, with verification
   Work in three explicit roles, in order:
   1. ADVOCATE: build the strongest evidence-based case for the leading theory, using only
      high-quality sources (peer-reviewed studies, primary sources, guidelines). Cite inline.
   2. CRITIC (opposite incentive): your job is to REFUTE the advocate — attack the weakest links,
      surface disconfirming evidence, name biases/limitations, find higher-quality contradicting
      sources. Do not be charitable.
   3. JUDGE: weigh both sides on evidence QUALITY (not volume); state which is stronger and your
      confidence, and why.
   Apply chain-of-verification to every load-bearing claim: after stating it, verify against a
   separate source before relying on it; flag anything you couldn't verify.
   ## Output format (required)
   Markdown with inline citations on every factual claim. End with a "## Summary" (bottom line in
   3–6 sentences), then one line starting "STORE THIS FACT:" — a single sentence stating the
   headline conclusion, written to stand alone as a fact.

4. Then tell them briefly: run this in your Deep Research tool and send the report back — upload
   the .md/.txt/.pdf (best for long reports) or paste it — and I'll archive it and remember the conclusion.

## Phase B — Ingest the returned report
You now have the report text (pasted, or extracted from an uploaded file shown as [Document: …]).
1. Call archive_research_report with { title: <short title>, markdown: <full report text>,
   related_entity: <entity name if any> }. This archives + embeds it (searchable forever).
2. If there's a related entity, store ONE summary fact: call remember with a single fact on that
   entity (create the entity first in the same batch if it doesn't exist yet). Use the report's
   "STORE THIS FACT:" / Summary line as the value. Do NOT store dozens of granular facts — the
   full text lives in the archive; only the one summary goes to the knowledge graph.
3. Confirm in 1–2 lines and surface the headline conclusion. Don't paste the whole report back —
   they already have it. Later, recall it with search_archives (source_type: "research_report")
   or query_knowledge for the summary fact.
```

---

## Verification (end-to-end)

1. **Migrate + reload:** `make migrate` (seeds the skill), then `make dev`. Confirm seed: `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT name FROM skills;"'`
2. **Type-check:** `deno check src/main.ts` passes (authoritative; ignore IDE `@/` errors).
3. **Discovery:** send any message; `make trace last` → "## Available Skills" lists `deep_research`.
4. **Kickoff → brief:** "deeply research ketogenic diet as a treatment for Dana's psychiatric symptoms." Expect `fetch_skill` → `query_knowledge` → optional `web_search` → a filled brief. (`make trace last replay`)
5. **Ingest (paste):** paste a short mock report (with `## Summary` + `STORE THIS FACT:`). Expect `archive_research_report` then `remember`. Verify:
   - `SELECT source_type, original_filename FROM archived_files WHERE source_type='research_report';`
   - `SELECT count(*) FROM document_chunks WHERE source_type='research_report';`
   - `SELECT attribute, value FROM facts f JOIN entities e ON e.id=f.entity_id WHERE e.name ILIKE '%Dana%' AND attribute LIKE 'research%';`
6. **Ingest (upload):** `.pdf` (works today) and, if Task 5 done, `.md`.
7. **Later retrieval:** fresh turn — "what did the keto research conclude?" → `search_archives` / `query_knowledge` surfaces it.

---

## Footprint: core vs optional vs rejected

- **Core (ships the feature):** Task 1 (source type, 1 line) + Task 2 (one tool, ~60 lines) + Task 3 (registration, 2 lines) + Task 4 (skill migration). Kickoff → brief → paste/PDF ingest → retrieval all work.
- **Recommended add:** Task 5 (clean `.md`/`.txt` upload) — the realistic path for long reports.
- **Optional / phase-2:** dedup when re-ingesting an already-archived upload (harmless duplicate today; `archiveFile` content-hashes via sha256); a `research_report` ranking boost in search (not needed).
- **Rejected:** a `research_note` entity type — would touch the locked entity-type enum and pollute entity search; attach the summary fact to the related entity instead (matches [workflow-medical-research.md:112-127](workflow-medical-research.md)).

---

## Future / phase-2 (autonomous, out of scope)

If the user later wants hands-off research, the skill + archival layer built here is the foundation. The additional pieces:
- A **background job runner** (research-jobs table + worker + notify-on-done via `send_message`), since the event loop is synchronous.
- An **orchestrator-worker loop** over the Claude API (lead agent → parallel subagents → synthesis → adversarial teardown → judge), per Anthropic's pattern.
- Optional **research-grade backends** via the MCP connector (Exa/Firecrawl/ScrapeGraphAI for web; free PubMed/Europe PMC/Semantic Scholar/OpenAlex for medical).
- **Cost controls:** prompt caching + hierarchical model selection (Haiku workers, Sonnet synthesis, Opus judge) → ~$30–40/task.

---

## Key references

- [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [*Talk Isn't Always Cheap: Failure Modes in Multi-Agent Debate* (ICML 2025)](https://arxiv.org/pdf/2509.05396) · [Chain-of-Verification](https://arxiv.org/pdf/2309.11495)
- [LangChain Open Deep Research](https://github.com/langchain-ai/open_deep_research) · [dzhng/deep-research](https://github.com/dzhng/deep-research) · [GPT Researcher](https://github.com/assafelovic/gpt-researcher)
- [Anthropic MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector) · [Anthropic API pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [ScrapeGraphAI](https://scrapegraphai.com/) · [Exa MCP](https://github.com/exa-labs/exa-mcp-server) · [Firecrawl MCP](https://github.com/firecrawl/firecrawl-mcp-server) · [PubMed MCP](https://github.com/JackKuo666/PubMed-MCP-Server)
