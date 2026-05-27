# Workflow: Long-Term Recall

Detailed step-by-step trace of what happens when a user references a conversation from six months ago. Tests the data lifecycle ([data-lifecycle.md](../data-lifecycle.md)), the three-tier memory model, compaction, context assembly ([context-assembly.md](../context-assembly.md)), and the knowledge graph's role as long-term memory. See [workflow-tasks-and-projects.md](workflow-tasks-and-projects.md) for event/task workflows and [workflow-financial-tracking.md](workflow-financial-tracking.md) for financial workflows.

This workflow is split into two parts. Part 1 traces the original conversation (November 2025) — what the agent extracts and stores in real time. Part 2 traces the recall (May 2026) — what survives six months later and what the user actually experiences when they ask about it.

---

## Part 1: The Original Conversation — November 2025

**User message:** *"I want to start a vitamin and supplement stack. Can you help me put one together? I'm mostly interested in energy, sleep quality, and joint health."*

This is a collaborative, multi-turn knowledge work conversation. The user is asking the agent to co-create a plan — not retrieve a fact or manage a task. The output is a structured recommendation that the user intends to act on but isn't writing down anywhere else.

### Step 1 — Telegram message → event queue

grammY receives the message, pushes it as a high-priority event:

```typescript
queue.push({
  type: "user_message",
  priority: "high",
  payload: {
    text: "I want to start a vitamin and supplement stack. Can you help me put one together? I'm mostly interested in energy, sleep quality, and joint health.",
    chat_id: 12345
  }
});
```

### Step 2 — Context assembly

The event loop assembles the prompt:

- **Layer 1 (stable prefix):** System prompt, tool definitions (including `query_knowledge` and `remember`), user preferences. Cached.
- **Layer 2 (daily prefix):** Today's calendar, active tasks, pending items. Cached. Nothing health-related is currently active.
- **Layer 3 (recent prefix):** Recent conversation context. Might include recent conversations about other topics.
- **Layer 4 (raw conversation):** The new user message.

The LLM sees the `remember` tool definition, which handles storing entities, facts, relationships, and preferences. It also sees `query_knowledge`, which can check if the user has existing health-related information stored.

### Step 3 — LLM reasons about the request

The LLM's reasoning:

- The user wants to build a supplement plan from scratch
- Three stated goals: energy, sleep quality, joint health
- This will be a multi-turn conversation — the LLM should propose a stack, then refine based on feedback
- There may be health facts already in the knowledge graph (allergies, medications, existing supplements) worth checking before recommending anything
- The output of this conversation should be stored as a structured plan the user can reference later

### Step 4 — LLM checks existing knowledge, then responds

**Tool call 1: `query_knowledge`**

```json
{
  "tool": "query_knowledge",
  "input": {
    "question": "user health information, allergies, medications, current supplements, dietary restrictions"
  }
}
```

The knowledge graph returns what it has:

```
Known facts about user:
- No known allergies (no records)
- No current medications (no records)
- No current supplements (no records)
- Diet: no restrictions noted
```

Sparse results — this is the first health-related conversation. The LLM proceeds with a general recommendation and asks clarifying questions.

**LLM response (sent via Telegram):**

*"Happy to help build a stack. A few questions first:*

*1. Any medications or existing supplements?*
*2. Any allergies or sensitivities (fish, shellfish, soy)?*
*3. For joint health — is this preventive, or are you dealing with specific pain?*
*4. Budget preference — cost-conscious, or willing to spend more for premium forms?*

*While you answer, here's a starting framework based on your three goals:*

*Energy: vitamin D3, B-complex, magnesium*
*Sleep: magnesium glycinate (double-duty), L-theanine*
*Joints: omega-3 (fish oil), collagen peptides, glucosamine*

*We can dial in dosages and timing once I know more."*

**No `remember` call yet.** The LLM hasn't received enough confirmed information to store. The proposed stack is the LLM's draft, not the user's plan. Storing it now would mean storing a recommendation the user hasn't agreed to.

### Step 5 — User responds with details

*"No medications. No allergies. The joints are preventive — I run a lot and want to stay ahead of it. Keep it mid-range on cost, I don't need the fanciest stuff but don't want garbage either."*

New high-priority event. The LLM has full conversation context in Layer 4.

### Step 6 — LLM stores new health facts and refines the plan

**Tool call 1: `remember`**

Now the LLM has confirmed facts worth storing:

```json
{
  "tool": "remember",
  "input": {
    "extractions": [
      {
        "type": "fact",
        "entity_hint": "user",
        "attribute": "medications",
        "value": "none"
      },
      {
        "type": "fact",
        "entity_hint": "user",
        "attribute": "allergies",
        "value": "none known"
      },
      {
        "type": "fact",
        "entity_hint": "user",
        "attribute": "exercise_routine",
        "value": "running, regular"
      },
      {
        "type": "fact",
        "entity_hint": "user",
        "attribute": "health_goal",
        "value": "joint health — preventive, runner"
      }
    ]
  }
}
```

The `remember` application code writes four facts to the knowledge graph, each with `valid_from = now()` and `source_ref` pointing to the conversation record.

**LLM response (sent via Telegram):**

*"Good — no contraindications to worry about. Here's the refined stack:*

*Morning (with breakfast):*
*— Vitamin D3: 5,000 IU*
*— Omega-3 fish oil: 2g (look for ~1g combined EPA/DHA)*
*— Glucosamine + chondroitin: 1,500mg / 1,200mg combo*
*— B-complex: one tablet*

*Evening (30 min before bed):*
*— Magnesium glycinate: 400mg (helps both sleep and joints)*
*— L-theanine: 200mg*
*— Collagen peptides: 10g (can mix into water or tea)*

*The magnesium glycinate is the key dual-purpose pick — it's better absorbed than oxide and the glycinate form specifically helps with sleep. The collagen goes in the evening because there's some evidence it's better absorbed on a less-full stomach.*

*Want to adjust anything?"*

### Step 7 — User agrees and finalizes

*"That looks solid. Let's go with it. I'll order these this weekend."*

### Step 8 — LLM stores the finalized plan

Now the user has confirmed the stack. This is the critical moment — everything stored now is what the agent will have to work with six months from now. The LLM needs to capture the plan in enough detail that it can be reconstructed from the knowledge graph alone.

**Tool call 1: `remember`**

```json
{
  "tool": "remember",
  "input": {
    "extractions": [
      {
        "type": "entity",
        "entity_type": "plan",
        "name": "vitamin stack",
        "facts": [
          {"attribute": "status", "value": "active"},
          {"attribute": "goals", "value": "energy, sleep quality, joint health (preventive, runner)"},
          {"attribute": "started", "value": "2025-11-15"}
        ]
      },
      {
        "type": "fact",
        "entity_hint": "vitamin stack",
        "attribute": "morning_vitamin_d3",
        "value": "5,000 IU, with breakfast"
      },
      {
        "type": "fact",
        "entity_hint": "vitamin stack",
        "attribute": "morning_omega3",
        "value": "2g fish oil (~1g combined EPA/DHA), with breakfast"
      },
      {
        "type": "fact",
        "entity_hint": "vitamin stack",
        "attribute": "morning_glucosamine_chondroitin",
        "value": "1,500mg glucosamine + 1,200mg chondroitin, with breakfast"
      },
      {
        "type": "fact",
        "entity_hint": "vitamin stack",
        "attribute": "morning_b_complex",
        "value": "one tablet, with breakfast"
      },
      {
        "type": "fact",
        "entity_hint": "vitamin stack",
        "attribute": "evening_magnesium",
        "value": "400mg magnesium glycinate, 30 min before bed"
      },
      {
        "type": "fact",
        "entity_hint": "vitamin stack",
        "attribute": "evening_ltheanine",
        "value": "200mg L-theanine, 30 min before bed"
      },
      {
        "type": "fact",
        "entity_hint": "vitamin stack",
        "attribute": "evening_collagen",
        "value": "10g collagen peptides, 30 min before bed"
      }
    ]
  }
}
```

The `remember` application code:

1. Creates a `plan` entity with name "vitamin stack" and a generated UUID
2. Links it to the user entity via an `owns` relationship
3. Creates 10 facts on the entity (3 metadata facts + 7 supplement facts)
4. Each fact has `valid_from = 2025-11-15` and `valid_until = NULL` (currently active)
5. Each fact has `source_ref` pointing to the conversation in the archive

**What the database looks like after the `remember` call:**

```sql
-- Entity
INSERT INTO entities (id, type, name, properties)
VALUES ('uuid-vitamin-stack', 'plan', 'vitamin stack', '{}');

-- Relationship
INSERT INTO relationships (source_id, target_id, type, valid_from)
VALUES ('uuid-user', 'uuid-vitamin-stack', 'owns', '2025-11-15');

-- Facts (one per supplement, plus metadata)
INSERT INTO facts (entity_id, attribute, value, valid_from, source_ref)
VALUES
  ('uuid-vitamin-stack', 'status', 'active', '2025-11-15', '/archive/2025/11/conversations/...'),
  ('uuid-vitamin-stack', 'goals', 'energy, sleep quality, joint health (preventive, runner)', '2025-11-15', '/archive/...'),
  ('uuid-vitamin-stack', 'started', '2025-11-15', '2025-11-15', '/archive/...'),
  ('uuid-vitamin-stack', 'morning_vitamin_d3', '5,000 IU, with breakfast', '2025-11-15', '/archive/...'),
  ('uuid-vitamin-stack', 'morning_omega3', '2g fish oil (~1g combined EPA/DHA), with breakfast', '2025-11-15', '/archive/...'),
  ('uuid-vitamin-stack', 'morning_glucosamine_chondroitin', '1,500mg glucosamine + 1,200mg chondroitin, with breakfast', '2025-11-15', '/archive/...'),
  ('uuid-vitamin-stack', 'morning_b_complex', 'one tablet, with breakfast', '2025-11-15', '/archive/...'),
  ('uuid-vitamin-stack', 'evening_magnesium', '400mg magnesium glycinate, 30 min before bed', '2025-11-15', '/archive/...'),
  ('uuid-vitamin-stack', 'evening_ltheanine', '200mg L-theanine, 30 min before bed', '2025-11-15', '/archive/...'),
  ('uuid-vitamin-stack', 'evening_collagen', '10g collagen peptides, 30 min before bed', '2025-11-15', '/archive/....');
```

**LLM response (sent via Telegram):**

*"Locked in. I've saved the full stack — you can ask me about it anytime. I'd suggest reassessing in 6-8 weeks once you've had time to notice effects. Want me to set a reminder?"*

### Step 9 — User declines the reminder

*"Nah I'll just bring it up when I want to talk about it."*

The LLM responds with a brief confirmation. No event or task is created. The conversation is over.

### Step 10 — Conversation persisted, audit logged

The full exchange (roughly 8 messages) is written to the `conversations` table. The audit log records the entity creation and fact storage.

---

### What happens to this conversation over the next six months

This is where the data lifecycle ([data-lifecycle.md](../data-lifecycle.md)) and the three-tier memory model determine what survives and what's lost.

#### Week 1 (hot tier)

Everything is intact:

- The full raw conversation is in the `conversations` table and available in Layer 4 if the user continues the topic
- All 10 knowledge graph facts are in the `facts` table with `valid_until = NULL`
- The vitamin stack entity and its relationship to the user are active
- The conversation is embedded in the active partition of `document_chunks` for semantic search
- The raw transcript is archived to B2 with a permanent embedding in the archive partition of `document_chunks`

If the user asks "what was that magnesium dosage?" the next day, the answer comes from Layer 4 (raw conversation still present) or a `query_knowledge` call — either way, full fidelity.

#### Week 2-3 (hot → warm transition)

The pruning engine runs its weekly pass. The vitamin stack conversation is now 2-3 weeks old. It gets classified as **substantive** (not routine) because it contains entity creation, fact storage, and a plan output. The pruning engine:

1. Runs LLM summarization on the conversation text
2. Produces a summary: *"User and assistant designed a vitamin/supplement stack targeting energy, sleep quality, and joint health (user is a runner, preventive). Finalized plan: morning (D3 5000 IU, omega-3 2g, glucosamine/chondroitin 1500/1200mg, B-complex) and evening (magnesium glycinate 400mg, L-theanine 200mg, collagen peptides 10g). User declined a follow-up reminder. No medications or allergies."*
3. Summary replaces the full conversation text in the active partition of `document_chunks`
4. Active embedding regenerated from the summary
5. Verifies that all structured extractions exist in the knowledge graph (they do — all 10 facts, the entity, and the relationship)
6. Archive embedding and B2 transcript are untouched — permanent

**What leaves the fast path:** the specific back-and-forth reasoning — why magnesium glycinate over oxide, why collagen in the evening, the discussion about cost tiers. These are no longer in the active index or any prompt layer, but remain searchable via the archive index.

**What stays on the fast path:** the summary (in active `document_chunks`), and all 10 knowledge graph facts (unchanged, still in the facts table).

#### Months 2-5 (warm tier)

No significant changes. The summary sits in warm storage. The knowledge graph facts are unchanged — `valid_until` is still NULL for all of them because no one has modified the plan. The vitamin stack entity continues to exist.

The only thing that could change the facts during this period is if the user mentions a modification in a later conversation: *"I dropped the B-complex, it was making me nauseous."* That would trigger a new fact extraction with `valid_until = now()` on the old B-complex fact and a new fact recorded. But in this scenario, the user says nothing about the stack for six months.

#### Month 6 (warm → cold transition)

The monthly pruning job handles warm → cold transitions. The vitamin stack conversation summary is now ~5-6 months old. The pruning engine:

1. Folds the individual summary into a periodic summary for November 2025: *"November 2025: designed vitamin/supplement stack for energy, sleep, and joint health. Set up seven-supplement morning/evening routine. Also discussed [other November topics]."*
2. The individual conversation summary is removed from the active partition of `document_chunks`
3. The periodic summary is embedded and stored in the active partition
4. **Knowledge graph facts are untouched** — they persist indefinitely, pruning never modifies them
5. **Archive embedding is untouched** — the original full-text embedding in the archive partition is permanent

**After the warm → cold transition, what survives in active storage:**

| Storage location | Content | Retrievable how |
|---|---|---|
| `entities` table | "vitamin stack" entity (type=plan, UUID) | `query_knowledge` tool, entity name search |
| `facts` table | 10 facts: status, goals, started date, 7 supplements with dosages and timing | `query_knowledge` tool, entity-scoped fact query |
| `relationships` table | user → owns → vitamin stack | `query_knowledge` tool, relationship traversal |
| `document_chunks` (active) | November 2025 periodic summary (mentions the vitamin stack alongside other topics) | Vector search on active index |
| `document_chunks` (archive) | Original full-text embedding of the November 2025 conversation | Vector search on archive index — never pruned |
| B2 archive | Full raw transcript of the original conversation | Retrieved when archive index returns a match |

**What's NOT in active storage:**

- The full back-and-forth discussion
- The reasoning behind each supplement choice
- The alternatives considered
- The nuance about glycinate vs. oxide
- The discussion about collagen timing
- Any individual conversation summary (folded into the periodic summary)

---

## Part 2: The Recall — May 2026

**User message (May 26, 2026):** *"Hey, remember that vitamin stack we put together? I've been taking it for about six months now and I want to revisit it. The sleep stuff is working great but I don't think the joint supplements are doing much."*

This is the stress test. The user is referencing a specific conversation from six months ago, expecting the agent to recall the full plan and engage in a follow-up discussion about modifying it.

### Step 1 — Telegram message → event queue

Same as before. High-priority event enters the queue.

### Step 2 — Context assembly

The event loop assembles the prompt. Critically:

- **Layer 1 (stable prefix):** System prompt, tool definitions, user preferences. Cached. The user's preference for mid-range supplements might be here if it was stored as a preference (it wasn't in this trace — it was stored as conversational context, not a formal preference).
- **Layer 2 (daily prefix):** Today's calendar, active tasks. Nothing health-related unless the user has other active health items. Cached.
- **Layer 3 (recent prefix):** Recent conversation context. The vitamin stack conversation is NOT here — it's six months old, long past any compaction or recent-prefix window.
- **Layer 4 (raw conversation):** The new user message, plus the **pre-fetch teaser** (see below).

**Pre-fetch teaser.** Before the message reaches the LLM, application code runs a lightweight match against the knowledge graph using the user's message text. The result is a manifest appended alongside the message — not the facts themselves, just a summary of what's available:

```
[Knowledge graph context]
Highly relevant: "vitamin stack" (plan, active since 2025-11-15) — 10 facts
Moderately relevant: user health baseline — 3 facts
Archives not searched — may contain additional context. Use search_archives if needed.
```

The LLM sees this teaser before it starts reasoning. It knows the knowledge graph has detailed vitamin stack information without having to guess or make a speculative tool call. The teaser never includes the actual facts — just enough to inform the LLM's next step.

### Step 3 — LLM reasons about the request

The LLM reads the user's message and the pre-fetch teaser. It already knows the knowledge graph has a "vitamin stack" plan entity with 10 facts — it doesn't have to guess whether the system remembers. The LLM's reasoning:

- The user is referencing a previous plan we created together
- The teaser shows the knowledge graph has detailed information — I should pull the full facts
- The user says sleep is working, joints are not — this will involve modifying the stack
- I'll call `query_knowledge` to get the complete plan

### Step 4 — LLM queries the knowledge graph

**Tool call 1: `query_knowledge`**

```json
{
  "tool": "query_knowledge",
  "input": {
    "question": "vitamin stack plan, supplements, dosages, timing"
  }
}
```

The `query_knowledge` application code searches the active knowledge graph only:

1. **Text search** on entity names: finds the "vitamin stack" entity (type=plan)
2. **Fact retrieval** for that entity: returns all 10 facts where `valid_until IS NULL`
3. **Relationship traversal**: confirms user → owns → vitamin stack
4. **Temporal context**: notes `valid_from = 2025-11-15` on all facts — the plan was created about 6 months ago

The raw results are post-processed by a lightweight LLM call (Haiku) to condense and format them into a scannable summary optimized for the main agent's context window. The formatted result always ends with a nudge:

```
Entity: vitamin stack (plan)
  Status: active (since 2025-11-15)
  Goals: energy, sleep quality, joint health (preventive, runner)

  Morning (with breakfast):
    - Vitamin D3: 5,000 IU
    - Omega-3 fish oil: 2g (~1g combined EPA/DHA)
    - Glucosamine + chondroitin: 1,500mg / 1,200mg
    - B-complex: one tablet

  Evening (30 min before bed):
    - Magnesium glycinate: 400mg
    - L-theanine: 200mg
    - Collagen peptides: 10g

  Created: 2025-11-15
  Related facts:
    - User has no medications (current)
    - User has no known allergies (current)
    - User exercise: running, regular

---
If these results don't answer the question, try a different search query.
Archives were not searched and may contain additional context (conversation history, reasoning, documents). Use search_archives for deeper retrieval.
```

The Haiku post-processing groups facts by entity, detects the morning/evening structure from the attribute names, and pulls in related user health facts for context. This is context engineering described in [context-assembly.md](../context-assembly.md) — the tool returns condensed, scannable information, not raw fact rows. The archive nudge at the bottom is always present, regardless of how rich the results are.

A separate **`search_archives`** tool searches the archive index — vector embeddings of every original conversation transcript, email, document, and note ever archived to B2. The LLM calls it explicitly when it needs reasoning, historical context, or content that wasn't extracted as structured facts. Unlike `query_knowledge`, which returns structured knowledge graph data, `search_archives` returns relevant passages from original documents.

### Step 5 — LLM responds with full recall

The LLM now has the complete plan in its context window. Combined with the user's message about sleep working and joints not, it can respond substantively:

*"Yeah, here's what we set up in November:*

*Morning: D3 (5,000 IU), omega-3 (2g), glucosamine/chondroitin (1,500/1,200mg), B-complex*
*Evening: magnesium glycinate (400mg), L-theanine (200mg), collagen peptides (10g)*

*Good to hear the sleep side is working — the magnesium glycinate and L-theanine are probably doing the heavy lifting there.*

*On the joint side, you've been on glucosamine/chondroitin and collagen for six months with no noticeable improvement. A few options:*

*1. Drop the glucosamine/chondroitin — the clinical evidence is mixed and six months is a fair trial*
*2. Swap it for something with stronger evidence for runners — curcumin (turmeric extract) or UC-II collagen (different mechanism than peptides)*
*3. Keep the collagen peptides but increase to 15g — some studies show better results at higher doses for joint connective tissue*

*What's your thinking — simplify the stack, or swap the joint supplements for different ones?"*

### Step 6 — User wants to modify the stack

*"Let's drop the glucosamine and try the curcumin instead. Keep the collagen at 10g for now."*

### Step 7 — LLM updates the knowledge graph

**Tool call 1: `remember`**

The LLM needs to do two things: close out the old fact (glucosamine/chondroitin) and add the new one (curcumin). The `remember` tool handles temporal fact updates.

```json
{
  "tool": "remember",
  "input": {
    "extractions": [
      {
        "type": "fact_update",
        "entity_hint": "vitamin stack",
        "attribute": "morning_glucosamine_chondroitin",
        "action": "close",
        "reason": "user reports no improvement after 6 months"
      },
      {
        "type": "fact",
        "entity_hint": "vitamin stack",
        "attribute": "morning_curcumin",
        "value": "500mg curcumin (turmeric extract with piperine for absorption), with breakfast"
      }
    ]
  }
}
```

The `remember` application code:

1. Finds the glucosamine/chondroitin fact on the vitamin stack entity and sets `valid_until = now()`
2. Creates a new fact for curcumin with `valid_from = now()` and `valid_until = NULL`

```sql
-- Close out the old supplement
UPDATE facts SET valid_until = now()
WHERE entity_id = 'uuid-vitamin-stack'
  AND attribute = 'morning_glucosamine_chondroitin'
  AND valid_until IS NULL;

-- Add the new supplement
INSERT INTO facts (entity_id, attribute, value, valid_from, source_ref)
VALUES ('uuid-vitamin-stack', 'morning_curcumin',
        '500mg curcumin (turmeric extract with piperine for absorption), with breakfast',
        now(), '/archive/2026/05/conversations/...');
```

**The temporal model is doing exactly what it was designed for.** If someone asks "what supplements was the user taking in January 2026?" the answer includes glucosamine/chondroitin (its `valid_from` is November 2025 and `valid_until` is May 2026). If someone asks "what's the current stack?" the query filters to `valid_until IS NULL` and returns curcumin instead. This is the same temporal pattern used for employment history, addresses, and account balances — facts that are true for a period, then superseded.

**LLM response:**

*"Done — dropped glucosamine/chondroitin, added 500mg curcumin. Updated stack:*

*Morning: D3 (5,000 IU), omega-3 (2g), curcumin (500mg), B-complex*
*Evening: magnesium glycinate (400mg), L-theanine (200mg), collagen (10g)*

*The curcumin works best with piperine (black pepper extract) — most good brands include it. Look for one that says 'with BioPerine' or similar. Give it 8-12 weeks for joint effects.*

*Want me to set a reminder to check in on the curcumin in a couple months?"*

### Step 8 — User accepts

*"Yeah, remind me in 10 weeks."*

**Tool call: `manage_events`**

```json
{
  "tool": "manage_events",
  "input": {
    "action": "create",
    "event": {
      "title": "Check in on curcumin / vitamin stack",
      "type": "fixed",
      "priority": "low",
      "dtstart": "2026-08-04T09:00:00Z",
      "category": "health",
      "entity_id": "uuid-vitamin-stack"
    }
  }
}
```

The event is linked to the vitamin stack entity via `entity_id`. When this reminder fires in August, the briefing context will include the vitamin stack's current facts — the LLM won't need to search for it because the event's entity link pulls the relevant context automatically.

---

### What the database looks like after the full workflow

| Table | Rows | Content |
|---|---|---|
| `entities` | 1 | "vitamin stack" (type=plan) |
| `facts` | 11 | 10 original facts (1 now closed: glucosamine, `valid_until = 2026-05-26`) + 1 new (curcumin) |
| `relationships` | 1 | user → owns → vitamin stack |
| `events` | 1 | "Check in on curcumin" reminder, August 4 |
| `reminders` | 1 | August 4 at 9:00 AM |
| `conversations` | ~12 | Full May 2026 conversation thread |
| B2 archive | 2 files | November 2025 transcript + May 2026 transcript |

### What the user experienced

The user said "remember that vitamin stack?" and the agent responded with the complete plan — every supplement, every dosage, every timing detail. From the user's perspective, the agent remembered perfectly. There was no visible degradation, no "I think we discussed something about vitamins," no vague hand-waving.

This works because the knowledge graph captured the plan as structured facts at the moment the user confirmed it. The original conversation text — the back-and-forth about why glycinate, the cost discussion, the collagen timing reasoning — is gone from active storage. But the user didn't ask for that. They asked for the plan, and the plan is fully intact in the knowledge graph.

---

## Analysis: What Survives and What Doesn't

### What the knowledge graph preserves perfectly

**Structured outputs.** Anything the LLM captured as a discrete fact with a clear attribute/value pair survives indefinitely:

- Supplement names, dosages, and timing
- The plan's goals and start date
- The user's health baseline (no medications, no allergies, runner)
- Temporal transitions (when a supplement was added or dropped, and why)

These facts are as retrievable on day 1 as they are on day 1,000. The knowledge graph doesn't age them — `valid_until IS NULL` means "still true." The only cost is storage, and 10 facts is ~2KB.

### What leaves the fast retrieval path

**Reasoning and context.** The _why_ behind each decision doesn't survive as structured facts in the knowledge graph. After 6 months, these aren't in the active index:

- "We chose glycinate over oxide because glycinate is better absorbed and the glycinate form specifically helps sleep"
- "Collagen in the evening because there's evidence it's better absorbed on a less-full stomach"
- "The user wanted mid-range cost, not premium"
- "We considered and rejected ashwagandha because [reason]"

This information was in the full conversation text (hot tier, weeks 1-2), then in the conversation summary (warm tier, months 1-5), then folded into a periodic summary that only mentions the vitamin stack in passing (cold tier, month 6+).

**But it's always in the archive index.** The original conversation transcript is in B2 with a permanent embedding in the archive partition of `document_chunks`. If the user asks "why did we pick glycinate?" the LLM calls `query_knowledge`, gets back the fact that the user takes glycinate but no reasoning, sees the archive nudge at the bottom of the results, and calls `search_archives` as a follow-up. The archive search finds the original November 2025 conversation, retrieves the relevant passage from B2, and returns it. The reasoning is recoverable — it requires a second tool call, but the nudge makes that decision easy for the LLM.

### Why reasoning doesn't need to be extracted as facts

The archive index makes this unnecessary. The knowledge graph stores structured outputs (what, how much, when) and the archive stores everything else (why, what alternatives were considered, what tradeoffs were discussed). There's no need to bloat the knowledge graph with reasoning facts like `design_decision_magnesium_form` — the original conversation is always vector-searchable in the archive.

The extraction guidance in the system prompt stays simple: extract the structured output (the plan, the decision, the actionable details) and let the archive handle the rest. The conversation transcript *is* the reasoning store.

### What if the extraction was poor?

The entire six-month recall hinges on Step 8 — the `remember` call when the user confirmed the plan. If the LLM had stored less:

**Scenario: LLM stores only a summary fact**

```json
{
  "type": "fact",
  "entity_hint": "user",
  "attribute": "vitamin_stack",
  "value": "taking a morning/evening supplement stack for energy, sleep, and joints"
}
```

Six months later, the user asks about the stack. The pre-fetch teaser shows one relevant fact. The LLM calls `query_knowledge` and gets back only the summary fact — thin results. The archive nudge at the bottom prompts it to call `search_archives`, which finds the original conversation transcript and returns the full details. The LLM can answer with full fidelity, but the response required two tool calls and an archive round-trip that good extraction would have avoided.

This is the difference between a `remember` call that captures the plan as 10 granular facts and one that captures it as a single summary. Good extraction means `query_knowledge` handles most queries without touching the archive. Poor extraction means the archive catches it, but at the cost of an extra tool call + embedding search + B2 retrieval on every query about that topic. The system prompt should instruct the LLM to extract actionable details: what, how much, when.

**Scenario: LLM forgets to call `remember` at all**

The conversation flows naturally to completion, but the LLM never calls the `remember` tool. All the plan details live only in the raw conversation text. The knowledge graph has nothing about the vitamin stack — no entity, no facts, no relationships.

Six months later, the user asks about the stack. The pre-fetch teaser shows no matching entities — the LLM immediately knows the knowledge graph has nothing. It could call `query_knowledge` anyway (which would confirm zero results and show the archive nudge), or skip straight to `search_archives` based on the teaser's reminder that archives may contain relevant context. Either way, the archive search finds the original conversation via semantic similarity, retrieves the transcript from B2, and returns it. The LLM reads the full conversation and can answer the question. The archive saved it.

But this is still a degraded experience. Every query about the vitamin stack requires an archive search. There's no structured entity to link events to (the August reminder couldn't have been created with an `entity_id`). There's no temporal fact trail — if the user modifies the stack later, there's no `valid_until` closing out old supplements. The knowledge graph's value is in making structured data fast and queryable; the archive is the safety net, not the primary path.

The system prompt must be explicit: **when a conversation produces a plan, decision, or structured output that the user might reference later, always store it in the knowledge graph before concluding the conversation.** This is the "act on available information" principle from [workflow-tasks-and-projects.md](workflow-tasks-and-projects.md), applied to knowledge extraction.

### Schema observation: plans as entities

The vitamin stack was stored as a `plan` entity with facts. This works, but it raises a question about entity types. The current schema has `entities.type` as a free-text field — the LLM can create any entity type. "plan" isn't in the original design (which envisioned people, organizations, accounts, etc.), but it works naturally.

The alternative would be a dedicated `plans` table. But the same argument from [data-architecture.md](data-architecture.md) applies: at the scale of a personal assistant (tens to low hundreds of plans over years), the entity/fact model handles it without a dedicated table. The overhead of a new table and new tool isn't justified until plans need features that entities can't provide (dependencies, subtask tracking, version history). Those features belong in the task & project engine from [version-two.md](version-two.md) Phase 2, not in a separate plans table.

Using entities for plans does mean the `query_knowledge` tool needs to handle mixed entity types gracefully. A query for "my plans" should return the vitamin stack alongside other plan entities (workout routine, meal plan, career goals). The tool's application code can filter on `entities.type = 'plan'` when the query suggests the user is asking about plans specifically.
