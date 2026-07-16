# Workflow: Medical Research

Step-by-step trace through a medical research use case using the current V1 system. Tests web search (Anthropic server-side tool), knowledge graph reads and writes, the "don't aggressively store research" prompt guidance, and single-turn research constraints. See [workflow-research.md](workflow-research.md) for the future multi-round research architecture.

The walkthrough below uses a fictional patient and case, invented for this document.

---

## Walkthrough: "Research biologics for ulcerative colitis"

**User message (via Telegram):** *"Dana's GI said mesalamine isn't holding the flares anymore and mentioned moving to a biologic. Can you research it? What are the options, how do they pick one, and what are the risks?"*

This is a bounded research request grounded in a specific person the user cares about. It tests:

- **Knowledge graph retrieval** — Jarvis should check what he already knows about Dana's case before searching
- **Web search** — Anthropic's server-side tool, max 5 calls per turn
- **Storage decisions** — the system prompt says don't aggressively store research, but also says store findings that produce specific facts about an entity the user cares about
- **Response format** — this is a mobile chat, not a research paper

---

### Step 1 — Telegram message → event queue

grammY receives the message, pushes it as a high-priority event:

```typescript
queue.push({
  type: "user_message",
  priority: "high",
  payload: {
    text: "Dana's GI said mesalamine isn't holding the flares anymore and mentioned moving to a biologic. Can you research it? What are the options, how do they pick one, and what are the risks?",
    chat_id: 12345
  }
});
```

### Step 2 — Context assembly

The event loop picks up the event. `assembleContext()` builds the prompt:

- **System prompt:** BASE_PROMPT + skill list + user preferences. Cached via Anthropic ephemeral cache control.
- **Conversation history:** Recent messages truncated to ~20k token budget. This includes earlier notes about Dana's diagnosis and treatment history — Jarvis has context about the case.
- **New user message:** Appended as the final message.

Claude sees all tool definitions including `web_search` (Anthropic server-side, max 5 uses) and `remember` (batch storage).

### Step 3 — Claude reasons about the request

Claude's internal reasoning:

> The user is asking me to research biologic therapy in the context of Dana Whitfield's ulcerative colitis. I already have knowledge about Dana stored — diagnosis, current medication, flare history. Let me check what I know, then search for medical information to answer the specific questions.
>
> Key decision: the system prompt says "do NOT aggressively remember general research content" but also says "only store research results that produce specific facts about an entity the user cares about." Dana is absolutely an entity we care about. So:
> - General facts about biologics (drug classes, mechanisms of action) → DON'T store
> - Facts specifically relevant to Dana's situation (e.g., step therapy requirements, which class fits her disease extent) → COULD store, but these are general medical facts, not facts about Dana herself
> - If I discover something that updates Dana's record (e.g., a contraindication given her history) → STORE

### Step 4 — First tool calls

**Tool call 1: `query_knowledge`**

```json
{
  "query": "Dana Whitfield ulcerative colitis treatment mesalamine"
}
```

Returns stored facts:

```
Entity: Dana Whitfield (person)
- diagnosis: "Ulcerative colitis, left-sided, diagnosed ~March 2025..."
- current_medication: "Mesalamine 4.8g/day, oral..."
- flare_history: "Three flares in the past twelve months, two requiring prednisone..."
- gi_treatment_reasoning: "Dr. Alvarez noted escalating flare frequency despite maximal 5-ASA..."
```

Claude now has Dana's specific context. It proceeds to web search.

**Tool call 2: `web_search`** (Anthropic server-side)

Claude decides to search. The API returns `stop_reason: "pause_turn"` — the search executes server-side, and Claude receives results automatically on the next loop iteration. No client-side execution needed.

Claude's search: "ulcerative colitis biologic therapy classes anti-TNF vedolizumab ustekinumab"

### Step 5 — Claude processes search results and searches again

Claude receives web search results in its context. The Anthropic server-side tool returns snippets and source URLs. Claude reads through them and identifies that it needs more specific information.

**Tool call 3: `web_search`**

"ulcerative colitis biologic selection criteria disease extent prior therapy"

**Tool call 4: `web_search`**

"biologic therapy ulcerative colitis risks infection malignancy screening"

Each search triggers `stop_reason: "pause_turn"`, loops back to Claude with results. Claude now has enough to answer all three questions.

### Step 6 — Claude decides what to store

This is the critical decision point. Claude has learned:

- The main classes are anti-TNF agents, anti-integrin agents, and anti-IL-12/23 agents
- Selection depends on disease extent, severity, prior therapy, and comorbidities
- Gut-selective agents carry a lower systemic immunosuppression burden
- Pre-treatment screening for latent tuberculosis and hepatitis B is standard
- Insurers commonly require step therapy — documented 5-ASA failure before approving a biologic

**What Claude decides to store:**

The system prompt guidance creates a genuine tension. These are general medical facts, not facts about Dana. But they're directly actionable for Dana's case — "insurers require documented 5-ASA failure first" is something the family should know, and storing it means Jarvis can reference it later without re-searching.

Most likely behavior: Claude stores **nothing** to the knowledge graph. The prompt says "don't aggressively remember general research content" and these are all general medical facts. Claude may update one existing fact:

```json
{
  "items": [
    {
      "type": "fact",
      "fact": {
        "entity_name": "Dana Whitfield",
        "attribute": "treatment_escalation_status",
        "value": "Maximal 5-ASA failing. Biologic escalation under discussion. Step therapy likely satisfied by documented mesalamine failure; pre-treatment TB and hepatitis B screening required."
      }
    }
  ]
}
```

This is the right call — it's a fact about Dana's treatment status, not a general research fact. But it's also the only thing that gets stored. The detailed drug classes, selection criteria, and risk profiles are returned to the user as a message and then... gone. They exist only in conversation history, which will be truncated as new messages come in.

### Step 7 — Claude delivers the response

Claude sends a Telegram message:

> **Biologics for ulcerative colitis — key findings for Dana's situation:**
>
> **Three main classes.** Anti-TNF agents (infliximab, adalimumab) are the long-established first choice. Anti-integrin agents (vedolizumab) are gut-selective, meaning less systemic immunosuppression. Anti-IL-12/23 agents (ustekinumab) are another option, often after an anti-TNF fails.
>
> **How they pick one:** Disease extent and severity, prior therapy, comorbidities, and how fast you need a response. Anti-TNF agents work faster, which matters for active flares. Gut-selective agents trade some speed for a better safety profile — often favored when infection risk is the main concern. Dana's left-sided disease and repeated steroid courses are both inputs here.
>
> **Risks:**
> - Infection risk, from immunosuppression. Screening for latent TB and hepatitis B before starting is standard.
> - Infusion or injection reactions, usually manageable.
> - Long-term malignancy signal exists for anti-TNF agents but is small in absolute terms.
> - Loss of response over time is common — antibodies form against the drug, so levels get monitored.
>
> One practical note: insurers usually require documented 5-ASA failure before approving a biologic. Dana's flare history on maximal mesalamine should satisfy that, but it's worth making sure the GI office documents it explicitly.
>
> Worth asking Dr. Alvarez: given the flare frequency, is a gut-selective agent like vedolizumab on the table, or does the pace argue for anti-TNF?

The response is delivered via `sendTelegramMessage`, persisted to conversation history.

### Step 8 — What's in the system after this workflow

| Component | What happened |
|-----------|---------------|
| **Knowledge graph** | 0-1 new facts. At most, one fact updating Dana's treatment status. All other research is ephemeral. |
| **Conversation history** | Full exchange stored — user question, tool calls, assistant response. Will be truncated when history exceeds ~20k token budget. |
| **Archives (B2)** | Nothing. No mechanism to archive web search results or research documents in V1. |
| **Web search** | 3 searches consumed (of 5 max per turn). Results exist only in the Anthropic API response — not persisted anywhere. |

---

## What works well

1. **The query_knowledge → web_search → respond loop is natural.** Claude checks existing knowledge, fills gaps with web search, and responds. No orchestration needed.
2. **The "don't aggressively store research" guidance prevents knowledge graph pollution.** General medical facts about biologic drug classes don't belong as permanent facts on the Dana entity. They'd become stale, potentially misleading, and hard to clean up.
3. **Anthropic's server-side web search is zero-implementation.** No API keys, no client-side execution, no result parsing. Claude just decides to search and it happens.

## What's missing — gaps exposed by this workflow

### 1. Research results are ephemeral

The detailed drug classes, selection criteria, and risk profiles that Claude found and presented exist in exactly one place: conversation history. When that history is truncated (which happens every few turns at ~20k tokens), the research is gone. If the user asks "what did you find about biologic options?" a week later, Jarvis has nothing.

**What the user expects:** "I told you to research it. You should know this."

**What actually happens:** Jarvis would need to re-search from scratch.

**What's needed:** A way to archive research results — either as a document in B2, or as a structured "research note" entity in the knowledge graph, or both. Note: `search_archives` now exists, but it only searches *uploaded files* (transcripts, OCR'd documents) — `web_search` results are still never archived, so this gap stands. Closing it needs the research document archival in [workflow-research.md](workflow-research.md), which writes findings into the same `document_chunks` index `search_archives` reads.

### 2. The storage guidance creates a dead zone

The system prompt says:
- Aggressively store facts about entities the user cares about ✓
- Don't aggressively store general research ✓
- Store research results that produce specific facts about an entity the user cares about ✓

But "the biologic selection criteria that are directly relevant to Dana's case" falls in between. It's general medical knowledge, but it's actionable for a specific entity. Claude will likely err on the side of NOT storing, which means the research is lost.

**Possible fix:** Add a "research_note" concept — a lightweight entity type for research findings that are tied to a specific entity but contain general knowledge. Something like:

```json
{
  "type": "entity",
  "entity": {
    "name": "UC biologic therapy research (Dana Whitfield)",
    "type": "research_note",
    "properties": { "related_entity": "Dana Whitfield", "date": "2025-05-30" }
  }
}
```

With facts attached: drug classes, selection criteria, risk profiles. Tagged as research, linked to Dana, retrievable later. This doesn't exist today.

### 3. No multi-round research

The user asked three questions. Claude can run up to 5 web searches per turn, which is enough for this request. But a more complex research task ("research every biologic and compare outcomes head to head") would hit the 5-search limit quickly.

**What happens when searches run out:** Claude answers with whatever it found in 5 searches. No way to continue in a follow-up turn because the search results aren't persisted — the next turn starts fresh with only conversation history context.

**What's needed:** Either increase the max_uses cap (cost trade-off) or build the ingestion pipeline from [workflow-research.md](workflow-research.md) for multi-round research with persistent results.

### 4. No source archival

Claude found medical information from web sources but there's no way to save those sources. The URLs exist momentarily in the API response but aren't captured by the client. If the user wants to read the original treatment guideline, Jarvis can't retrieve it.

**What's needed:** The archive pipeline from the future ingestion system — fetch substantive sources, archive to B2, link to research findings.

### 5. No way to share or export

The response is a Telegram message. If the user wants to share the research with family or doctors, they have to copy-paste from Telegram. No export to document, no email, no formatted output.

---

## What the user will actually experience

**The good:** Jarvis will give a solid, well-organized answer to the medical research question. The web search results are current, Claude's synthesis is strong, and the response is contextual — it references the specific situation (left-sided disease, repeated steroid courses, maximal 5-ASA) because those facts are in the knowledge graph.

**The frustrating:** Two weeks later, the user will ask "what were those selection criteria you found for biologics?" and Jarvis will have no memory of the research. The conversation history will have been truncated long ago, the knowledge graph has at most one fact about it, and the detailed criteria and risk profiles are gone. Jarvis will need to re-search, and the user will wonder why he didn't just remember.

**The gap to close:** Research results need a persistence layer between "ephemeral conversation" and "permanent knowledge graph fact." A research note or archived document that survives conversation truncation but doesn't pollute the entity fact model with general knowledge.

---

## Timing and cost

| Component | Estimate |
|-----------|----------|
| Context assembly | <1s |
| query_knowledge | <1s |
| web_search × 3 (server-side) | 3-8s total |
| Claude reasoning + response | 5-15s |
| **Total wall clock** | **10-25s** |
| **Cost** | **~$0.05-0.15** (single Claude turn with cached system prompt, 3 web searches) |

Fast and cheap for a single-turn research request. The limitation isn't speed or cost — it's persistence.
