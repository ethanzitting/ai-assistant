# Workflow: Research

Detailed step-by-step trace through a research use case. Tests the ingestion container (web search, source archival), the knowledge graph (storing findings with source attribution), the task engine (project decomposition), context assembly (multi-turn research synthesis), and the archive pipeline (saving primary sources to B2). See [workflow-financial-tracking.md](workflow-financial-tracking.md) for financial workflows and [workflow-tasks-and-projects.md](workflow-tasks-and-projects.md) for task workflows.

---

## Walkthrough: "Is the death penalty in war biblical?"

**User message:** *"I want you to research how scriptural it is to support the death penalty in war. Find high-quality sources — if there are studies or primary sources, save them. Then build the strongest possible case for biblical support of the death penalty in war, and the strongest possible case against it."*

This is the most complex research request the system handles. It requires:

- **Multiple rounds of web search** — the agent can't answer this from a single query
- **Source quality judgment** — theological scholarship vs. blog posts vs. primary texts
- **Archive decisions** — which sources are substantive enough to save permanently
- **Opposing argument construction** — the agent must steelman both sides from the same source material
- **Knowledge graph population** — findings stored as facts with source attribution for future retrieval
- **A structured research document** — the final deliverable, archived to B2

This tests every component in the research pipeline: agent → ingestion coordination, web search isolation, emission validation, archive policy, knowledge graph writes, and multi-turn context assembly.

---

### Step 1 — Telegram message → event queue

grammY receives the message, pushes it as a high-priority event:

```typescript
queue.push({
  type: "user_message",
  priority: "high",
  payload: {
    text: "I want you to research how scriptural it is to support the death penalty in war. Find high-quality sources — if there are studies or primary sources, save them. Then build the strongest possible case for biblical support of the death penalty in war, and the strongest possible case against it.",
    chat_id: 12345
  }
});
```

### Step 2 — Context assembly

The event loop picks up the event and assembles the prompt:

- **Layer 1 (stable prefix):** System prompt, tool definitions (including `manage_tasks`, `search_archives`, `remember`), user preferences. Cached.
- **Layer 2 (daily prefix):** Today's calendar, active tasks, pending items. Cached. Nothing financial or calendar-related is relevant here, but if the user has a prior research project on theology, those tasks would appear.
- **Layer 3 (recent prefix):** Recent conversation context. If the user has discussed theology, ethics, or biblical topics recently, that condensed context appears here.
- **Layer 4 (raw conversation):** The new user message.

The LLM sees tool definitions for `manage_tasks` (project/task creation), `search_archives` (semantic search over archived content), `remember` (knowledge graph writes), and critically, the system prompt instructions about how to trigger web research through the ingestion container.

### Step 3 — LLM reasons about the request

The LLM has a complex request to decompose. Its internal reasoning:

> This is a research project, not a quick lookup. The user wants:
> 1. High-quality sources found and evaluated
> 2. Primary sources and studies saved to the archive
> 3. The strongest biblical case FOR the death penalty in war
> 4. The strongest biblical case AGAINST the death penalty in war
>
> I need to:
> - Create a research project with tasks tracking each phase
> - Run multiple web searches: biblical texts on capital punishment, just war theology, scholarly commentary
> - Evaluate source quality — peer-reviewed theology journals and primary texts (Augustine, Aquinas, Calvin) outrank blog posts and opinion pieces
> - Archive the substantive sources
> - Synthesize findings into two steelmanned arguments
> - Produce a structured research document
>
> Key challenge: "death penalty in war" is a specific framing. This isn't just capital punishment generally — it's about whether Scripture supports killing enemy combatants or captured enemies during wartime. This intersects just war theory, Old Testament warfare commands, New Testament ethics, and the distinction between state authority and individual morality.

### Step 4 — LLM calls tools (first batch)

**Tool call 1: `query_knowledge`**

Before starting fresh research, the LLM checks whether the knowledge graph already contains relevant information:

```json
{
  "tool": "query_knowledge",
  "input": {
    "question": "biblical ethics, death penalty, just war, capital punishment, theology research"
  }
}
```

The application code queries the active knowledge graph — entities, facts, and relationships. Assuming this is a new topic for the user:

```
No relevant entities or facts found for: biblical ethics, death penalty, just war, capital punishment.

---
If these results don't answer the question, try a different search query.
Archives were not searched and may contain additional context (conversation history, reasoning, documents). Use search_archives for deeper retrieval.
```

**Tool call 2: `search_archives`**

Prompted by the archive nudge, the LLM checks whether any previously ingested content on this topic exists in the archive:

```json
{
  "tool": "search_archives",
  "input": {
    "query": "biblical support death penalty war just war theology"
  }
}
```

Returns empty — no prior research on this topic exists in the archive.

**Tool call 3: `manage_tasks`**

The LLM creates the research project and decomposes it into phases:

```json
{
  "tool": "manage_tasks",
  "input": {
    "action": "create",
    "project": {
      "title": "Research: biblical basis for death penalty in war",
      "description": "Comprehensive research on scriptural support for and against the death penalty in wartime. Deliverable: structured research document with steelmanned arguments on both sides, citing primary sources and scholarly commentary."
    },
    "tasks": [
      {
        "title": "Identify key biblical texts",
        "description": "Find Old and New Testament passages directly relevant to capital punishment, warfare, and state-sanctioned killing. Both supportive and critical texts.",
        "priority": "high",
        "surfacing_policy": "on_demand"
      },
      {
        "title": "Find scholarly sources and primary texts",
        "description": "Locate peer-reviewed theological scholarship, church father writings (Augustine, Aquinas), and modern ethical analyses. Save substantive sources to archive.",
        "priority": "high",
        "surfacing_policy": "on_demand"
      },
      {
        "title": "Build the case FOR biblical support",
        "description": "Steelman the argument that Scripture supports the death penalty in war. Use the strongest texts, most respected theological voices, and most coherent theological framework.",
        "priority": "high",
        "surfacing_policy": "on_demand"
      },
      {
        "title": "Build the case AGAINST biblical support",
        "description": "Steelman the argument that Scripture does not support the death penalty in war. Use the strongest texts, most respected theological voices, and most coherent theological framework.",
        "priority": "high",
        "surfacing_policy": "on_demand"
      },
      {
        "title": "Compile research document",
        "description": "Synthesize all findings into a structured research document. Archive to B2.",
        "priority": "high",
        "surfacing_policy": "on_demand"
      }
    ]
  }
}
```

All tasks use `surfacing_policy: "on_demand"` because this is a burst project — it will be completed in this session, not tracked over days. The project exists for audit trail and future reference, not for daily briefing surfacing.

### Step 5 — LLM acknowledges and begins research

Before diving into web search, the LLM sends an interim Telegram response so the user isn't left waiting in silence:

*"This is a substantial research project. I'm going to:*

*1. Search for key biblical texts on capital punishment and warfare*
*2. Find scholarly theological sources — church fathers, academic papers, respected commentaries*
*3. Save any primary sources worth keeping to the archive*
*4. Build the strongest case on each side*

*This will take several minutes. I'll send you the full analysis when it's ready."*

This is important — research tasks involve multiple sequential web searches, each requiring a round trip through the ingestion container. The user needs to know this isn't a 5-second answer.

### Step 6 — First web search: biblical texts on capital punishment and war

The LLM now needs external information. Per [ingestion.md](../ingestion.md), web search runs through the ingestion container, never in the agent. The LLM triggers research by inserting processing requests.

**The LLM composes a search request:**

```json
{
  "tool": "request_research",
  "input": {
    "searches": [
      {
        "query": "Bible verses death penalty capital punishment Old Testament New Testament",
        "intent": "Identify the key scriptural texts used in debates about capital punishment"
      },
      {
        "query": "biblical theology of war just war Old Testament warfare commands Deuteronomy",
        "intent": "Find Old Testament passages commanding or regulating warfare and killing in battle"
      },
      {
        "query": "Jesus teaching on violence killing Sermon on the Mount capital punishment New Testament ethics",
        "intent": "Find New Testament texts relevant to the ethics of killing, especially Jesus's direct teachings"
      }
    ]
  }
}
```

Under the hood, the `request_research` tool (a research-specific wrapper around the `processing_requests` coordination table) inserts three rows:

```sql
INSERT INTO processing_requests (type, source_type, metadata, status)
VALUES
  ('web_search', 'user_request', '{
    "query": "Bible verses death penalty capital punishment Old Testament New Testament",
    "intent": "Identify the key scriptural texts used in debates about capital punishment",
    "research_project_id": "uuid-research-project"
  }', 'pending'),
  ('web_search', 'user_request', '{
    "query": "biblical theology of war just war Old Testament warfare commands Deuteronomy",
    "intent": "Find Old Testament passages commanding or regulating warfare and killing in battle",
    "research_project_id": "uuid-research-project"
  }', 'pending'),
  ('web_search', 'user_request', '{
    "query": "Jesus teaching on violence killing Sermon on the Mount capital punishment New Testament ethics",
    "intent": "Find New Testament texts relevant to the ethics of killing, especially Jesus'\''s direct teachings",
    "research_project_id": "uuid-research-project"
  }', 'pending');
```

### Step 7 — Ingestion processes the web searches

The ingestion container polls `processing_requests` and picks up the three search requests. For each one:

#### 7a. Ingestion runs Anthropic web search

Ingestion calls the Anthropic web search API with the query. The API returns a set of search results with snippets and URLs. For the first query ("Bible verses death penalty capital punishment"), results might include:

- A Bible Gateway compilation of relevant verses
- A peer-reviewed journal article from *Journal of the Evangelical Theological Society* on Genesis 9:6
- A seminary course page listing key texts with scholarly commentary
- Several church blog posts and opinion articles
- A Bible encyclopedia entry on capital punishment

#### 7b. Ingestion fetches and processes top results

Ingestion fetches the full content of the most promising results (not all — the LLM in the ingestion container judges which are worth fetching based on snippet quality and source domain).

For each fetched page:

1. **Injection classifier scores the content.** Typical theological content scores 0.01-0.05 — very low risk. A page containing adversarial content would be flagged.

2. **Ingestion LLM extracts structured findings.** The ingestion LLM (Haiku, for cost) processes the fetched content with an extraction prompt tuned for research. It produces structured records, not raw HTML.

#### 7c. Ingestion emits structured records

For a scholarly article on Genesis 9:6 and capital punishment:

```sql
INSERT INTO ingestion_emissions (type, status, payload, source_type, source_ref, risk_score)
VALUES ('research_finding', 'pending', '{
    "research_project_id": "uuid-research-project",
    "source_title": "Genesis 9:6 and the Noahic Covenant: Foundations for Capital Punishment in Biblical Theology",
    "source_author": "Dr. James R. Hamilton",
    "source_publication": "Journal of the Evangelical Theological Society",
    "source_url": "https://example.edu/jets/genesis-9-6-capital-punishment",
    "source_quality": "high",
    "source_type": "peer_reviewed_journal",
    "findings": [
      {
        "claim": "Genesis 9:6 establishes capital punishment as a divine mandate predating the Mosaic law, grounded in the imago Dei — human life is so sacred that taking it demands the ultimate penalty",
        "scripture_refs": ["Genesis 9:6"],
        "relevance": "foundational_text",
        "position": "supports_death_penalty"
      },
      {
        "claim": "The Noahic covenant is universal (given to all humanity, not just Israel), which supporters argue makes the capital punishment mandate applicable across all nations and times, not limited to the Mosaic theocracy",
        "scripture_refs": ["Genesis 9:1-17"],
        "relevance": "theological_framework",
        "position": "supports_death_penalty"
      }
    ],
    "archive_recommendation": "save"
  }', 'web_search',
  'search:bible-verses-death-penalty-capital-punishment-OT-NT/2026-05-26',
  0.02);
```

For a comprehensive overview page listing relevant texts across both testaments:

```sql
INSERT INTO ingestion_emissions (type, status, payload, source_type, source_ref, risk_score)
VALUES ('research_finding', 'pending', '{
    "research_project_id": "uuid-research-project",
    "source_title": "Capital Punishment in the Bible: A Comprehensive Survey",
    "source_url": "https://example.com/bible-encyclopedia/capital-punishment",
    "source_quality": "medium",
    "source_type": "reference_encyclopedia",
    "findings": [
      {
        "claim": "Old Testament prescribes death for at least 18 offenses including murder (Ex 21:12), striking a parent (Ex 21:15), kidnapping (Ex 21:16), adultery (Lev 20:10), blasphemy (Lev 24:16), and Sabbath violation (Num 15:32-36)",
        "scripture_refs": ["Exodus 21:12-17", "Leviticus 20:10", "Leviticus 24:16", "Numbers 15:32-36"],
        "relevance": "scope_of_OT_capital_punishment",
        "position": "contextual"
      },
      {
        "claim": "Deuteronomy 20 provides specific warfare commands including instructions to offer peace before siege, but also commands to completely destroy certain Canaanite nations — the herem or devoted destruction",
        "scripture_refs": ["Deuteronomy 20:10-18"],
        "relevance": "warfare_commands",
        "position": "supports_death_penalty_in_war"
      },
      {
        "claim": "Romans 13:1-4 is the key New Testament text cited by death penalty supporters — the governing authority bears the sword as God'\''s servant to execute wrath on wrongdoers",
        "scripture_refs": ["Romans 13:1-4"],
        "relevance": "foundational_text",
        "position": "supports_death_penalty"
      },
      {
        "claim": "John 8:1-11 (woman caught in adultery) is cited by opponents — Jesus declines to enforce a death-eligible offense and says let him who is without sin cast the first stone",
        "scripture_refs": ["John 8:1-11"],
        "relevance": "foundational_text",
        "position": "against_death_penalty"
      },
      {
        "claim": "Matthew 5:38-44 — Jesus explicitly overturns lex talionis (eye for an eye) and commands love of enemies, which opponents argue fundamentally undermines retributive killing",
        "scripture_refs": ["Matthew 5:38-44"],
        "relevance": "foundational_text",
        "position": "against_death_penalty"
      }
    ],
    "archive_recommendation": "skip"
  }', 'web_search',
  'search:bible-verses-death-penalty-capital-punishment-OT-NT/2026-05-26',
  0.03);
```

Note the `archive_recommendation` field. The ingestion LLM judges whether each source is worth archiving per the research archive policy in [ingestion.md](../ingestion.md):

- The peer-reviewed journal article: **save** — high-quality scholarship the user might want to revisit
- The encyclopedia overview page: **skip** — useful for extracting a list of texts, but the content itself is generic reference material. The extracted findings go into the knowledge graph; the page doesn't go into the archive.

For the second search ("biblical theology of war just war"), ingestion might find:

- An academic paper on Deuteronomy 20 and the herem (devoted destruction) commands
- An entry from a theological dictionary on just war theory in the church fathers
- A seminary lecture PDF on Augustine's and Aquinas's just war frameworks
- Several modern evangelical and Catholic perspectives on war

For the third search ("Jesus teaching on violence"), ingestion might find:

- A scholarly article on the Sermon on the Mount and nonviolence
- A chapter from a book on early church pacifism
- Analysis of Jesus's "I came not to bring peace but a sword" (Matthew 10:34) in context
- Scholarly debate on whether Jesus's ethic was absolute pacifism or contextual nonviolence

Each search produces 3-8 `research_finding` emissions. Total: roughly 10-25 emissions across the three searches.

#### 7d. Ingestion archives substantive sources

Before emitting findings, ingestion archives the sources it judged worth keeping. For the peer-reviewed journal article:

```
files/2026/05/research/2026-05-26_genesis-9-6-noahic-covenant-capital-punishment.pdf
```

For a seminary lecture PDF on Augustine and Aquinas:

```
files/2026/05/research/2026-05-26_augustine-aquinas-just-war-framework.pdf
```

For a scholarly article on early church pacifism:

```
files/2026/05/research/2026-05-26_early-church-pacifism-first-three-centuries.pdf
```

The archive paths become `source_ref` values in the emissions, creating a permanent link between the extracted findings and the original source material.

Blog posts, opinion pieces, and generic overview pages are **not archived** — the ingestion LLM extracted the useful content (specific biblical references, specific arguments) and discarded the rest. The findings are in the emissions; the raw HTML is gone.

### Step 8 — The agent validates and processes emissions

The agent's emission polling loop picks up the pending `research_finding` emissions. For each one:

1. **Schema validation.** Verify required fields: `research_project_id`, `source_title`, `findings` array. Reject malformed emissions.
2. **Risk score check.** All emissions scored 0.01-0.05 (theological content is benign). If any scored above the threshold, the agent would process with extra caution but not reject.
3. **Knowledge graph writes.** The agent transforms each finding into knowledge graph records.

For the Genesis 9:6 journal article findings:

```sql
-- Create entity for the source
INSERT INTO entities (type, name, properties)
VALUES ('source', 'Genesis 9:6 and the Noahic Covenant: Capital Punishment in Biblical Theology', '{
    "author": "Dr. James R. Hamilton",
    "publication": "Journal of the Evangelical Theological Society",
    "source_quality": "high",
    "source_type": "peer_reviewed_journal",
    "archived_at": "files/2026/05/research/2026-05-26_genesis-9-6-noahic-covenant-capital-punishment.pdf"
}')
RETURNING id;  -- uuid-source-hamilton

-- Store findings as facts linked to the source entity
INSERT INTO facts (entity_id, attribute, value, valid_from, source_ref)
VALUES
  ('uuid-source-hamilton', 'finding',
   'Genesis 9:6 establishes capital punishment as a divine mandate predating the Mosaic law, grounded in the imago Dei',
   now(), 'files/2026/05/research/2026-05-26_genesis-9-6-noahic-covenant-capital-punishment.pdf'),
  ('uuid-source-hamilton', 'finding',
   'The Noahic covenant is universal — supporters argue the capital punishment mandate applies across all nations and times',
   now(), 'files/2026/05/research/2026-05-26_genesis-9-6-noahic-covenant-capital-punishment.pdf');
```

The agent also creates a relationship linking the source to the research project entity:

```sql
INSERT INTO relationships (from_entity_id, to_entity_id, type, properties)
VALUES ('uuid-source-hamilton', 'uuid-research-project-entity', 'contributes_to', '{
    "position": "supports_death_penalty",
    "scripture_refs": ["Genesis 9:6", "Genesis 9:1-17"]
}');
```

This repeats for every finding across all emissions. After processing, the knowledge graph contains:

- **Source entities** — one per substantive source, with quality ratings, authorship, and archive paths
- **Finding facts** — individual claims extracted from each source, linked to the source entity
- **Relationships** — each source linked to the research project, tagged with position (supports/opposes/contextual) and relevant scripture references

### Step 9 — LLM reviews initial findings and plans follow-up searches

After the first batch of emissions are processed, the tool loop returns results to the LLM. The LLM now has a substantial body of findings in its context. It reviews what it has and identifies gaps.

**Tool call: `query_knowledge`**

```json
{
  "tool": "query_knowledge",
  "input": {
    "question": "all research findings for biblical death penalty in war project, grouped by position"
  }
}
```

The application code queries the active knowledge graph and returns Haiku-formatted results:

```
Research findings for "biblical basis for death penalty in war":

SUPPORTS DEATH PENALTY IN WAR:
- Genesis 9:6 — divine mandate for capital punishment, predates Mosaic law [Hamilton, JETS, high quality]
- Noahic covenant universality — applies to all nations [Hamilton, JETS, high quality]
- Deuteronomy 20:10-18 — warfare commands, herem destruction of Canaanite nations [encyclopedia, medium quality]
- Romans 13:1-4 — governing authority bears the sword as God's servant [encyclopedia, medium quality]
- 1 Samuel 15 — God commands Saul to destroy the Amalekites completely [search result]

AGAINST DEATH PENALTY IN WAR:
- Matthew 5:38-44 — Jesus overturns lex talionis, commands love of enemies [encyclopedia, medium quality]
- John 8:1-11 — Jesus declines to enforce capital offense [encyclopedia, medium quality]

CONTEXTUAL / FRAMEWORK:
- Augustine's just war criteria — war can be just under specific conditions [lecture PDF, high quality]
- Aquinas's conditions for just war — proper authority, just cause, right intention [lecture PDF, high quality]

Sources archived: 3 (Hamilton article, Augustine/Aquinas lecture, early church pacifism article)
Sources extracted only: 4 (encyclopedia pages, blog compilations)

---
If these results don't answer the question, try a different search query.
Archives were not searched and may contain additional context (conversation history, reasoning, documents). Use search_archives for deeper retrieval.
```

The LLM identifies gaps:

> I have a solid set of "for" texts but the "against" side is thin. I need:
> - More on early church pacifism — the first 300 years of Christianity were largely pacifist
> - Scholarly treatment of the Sermon on the Mount as it applies to state violence
> - The prophetic tradition — Isaiah's swords into plowshares, Micah's vision of peace
> - Modern theological scholarship on whether Old Testament warfare commands are prescriptive or descriptive
> - The distinction between Mosaic theocracy commands (bound to ancient Israel) and universal moral principles

### Step 10 — Second round of web searches

The LLM triggers a second batch of targeted searches to fill the gaps:

```json
{
  "tool": "request_research",
  "input": {
    "searches": [
      {
        "query": "early church fathers pacifism first three centuries Christianity military service Tertullian Origen",
        "intent": "Find scholarly sources on the pacifist tradition in early Christianity — this is the strongest historical argument against biblical support for the death penalty in war"
      },
      {
        "query": "Old Testament herem warfare commands descriptive vs prescriptive hermeneutics Canaanite genocide theology",
        "intent": "Find scholarly debate on whether OT warfare commands are universal mandates or historically bound narratives"
      },
      {
        "query": "Isaiah swords plowshares prophetic vision peace eschatology warfare abolition",
        "intent": "Find the prophetic counter-tradition — Isaiah, Micah, Hosea envisioning the abolition of war as God's ultimate purpose"
      }
    ]
  }
}
```

These insert three more `processing_requests`. Ingestion picks them up and runs the same search → fetch → classify → extract → emit pipeline.

The second round produces higher-quality "against" findings:

- **Tertullian** (c. 200 AD): "The Lord, in disarming Peter, unbelted every soldier" — explicit early church pacifism
- **Origen** (c. 248 AD): Christians "do not go forth as soldiers" and fight through prayer, not violence
- **The Didache** and early church orders prohibiting military service for baptized Christians
- **Isaiah 2:4 / Micah 4:3**: "They shall beat their swords into plowshares" — the prophetic vision of war's abolition as God's eschatological purpose
- **Hosea 2:18**: God will abolish the bow, the sword, and war from the land
- Scholarly argument that herem commands were specific to the conquest narrative, not a universal mandate — the same God who commanded the conquest also commanded "you shall not murder" (Exodus 20:13), and the Hebrew Bible itself shows discomfort with the violence (e.g., David denied the right to build the temple because he was a man of blood, 1 Chronicles 22:8)

Ingestion archives two more substantive sources:

```
files/2026/05/research/2026-05-26_tertullian-origen-early-church-pacifism.pdf
files/2026/05/research/2026-05-26_herem-warfare-prescriptive-descriptive-hermeneutics.pdf
```

### Step 11 — Third round: primary theological sources

After processing the second batch of emissions, the LLM has strong material on both sides. But the user specifically asked for primary sources. The LLM runs one more targeted search:

```json
{
  "tool": "request_research",
  "input": {
    "searches": [
      {
        "query": "Augustine City of God book 19 just war theory primary text war and peace",
        "intent": "Find Augustine's original arguments for just war — this is the foundational primary source for the 'for' position"
      },
      {
        "query": "John Howard Yoder Politics of Jesus nonviolence Stanley Hauerwas Christian pacifism scholarly",
        "intent": "Find the key modern scholarly works arguing for Christian pacifism — Yoder and Hauerwas are the most cited"
      }
    ]
  }
}
```

Ingestion finds and archives:

- An academic translation/commentary on Augustine's *City of God* Book 19 — Augustine's original just war formulation, arguing that war is a tragic necessity in a fallen world and that the Christian ruler who wages war justly does so in service of peace
- A summary and analysis of Yoder's *The Politics of Jesus* — the most influential 20th-century argument that Jesus's nonviolent ethic is politically binding, not just a personal ideal

```
files/2026/05/research/2026-05-26_augustine-city-of-god-book-19-just-war.pdf
files/2026/05/research/2026-05-26_yoder-politics-of-jesus-nonviolence-analysis.pdf
```

### Step 12 — LLM marks research tasks complete and begins synthesis

After three rounds of search (7-8 total web searches, ~30-50 emissions processed, 5-7 sources archived), the LLM has enough material. It updates the project:

```json
{
  "tool": "manage_tasks",
  "input": {
    "action": "batch_update",
    "updates": [
      {"task_title": "Identify key biblical texts", "status": "done"},
      {"task_title": "Find scholarly sources and primary texts", "status": "done"}
    ]
  }
}
```

### Step 13 — LLM synthesizes the case FOR biblical support

The LLM now has all findings in context (via the knowledge graph query results returned through tool calls during the search rounds, plus the accumulated conversation in Layer 4). It constructs the steelmanned argument for biblical support of the death penalty in war.

This is a pure LLM reasoning step — no tool calls needed. The LLM draws on the structured findings, organized by position, with source attribution. It constructs the argument as a self-contained analysis, not a list of proof texts.

The LLM internally organizes the "for" argument into a theological framework:

1. **The Noahic foundation** — Genesis 9:6 establishes the principle before the Mosaic law, before Israel, before any specific covenant. Capital punishment is grounded in the *imago Dei* itself: human life is so sacred that taking it demands the forfeiture of one's own. This isn't vengeance; it's the ultimate affirmation of human dignity.

2. **The Mosaic elaboration** — The law expands capital punishment to specific offenses, demonstrating that God takes seriously the sins that destroy community. Deuteronomy 20's warfare commands show God directly authorizing killing in war under specific conditions.

3. **The Pauline confirmation** — Romans 13:1-4 is written *after* the cross, *after* the resurrection, *after* the Sermon on the Mount — and Paul still affirms that the governing authority "does not bear the sword in vain." The sword (*machaira*) is a death-dealing instrument, not a metaphor for parking tickets. Paul affirms the state's God-given authority to use lethal force.

4. **The just war tradition** — Augustine and Aquinas, building on Romans 13, argue that war can be a just exercise of the sword-bearing authority. The Christian soldier who kills in a just war acts as an agent of the governing authority, which is itself an agent of God's justice. Augustine: the sin is not in killing but in the disordered loves that cause unjust war — hatred, cruelty, lust for domination. A soldier who kills without hatred, in service of peace, under legitimate authority, does not sin.

5. **The Old Testament narrative** — God directly commands warfare against specific nations (1 Samuel 15, Joshua 6, Deuteronomy 20). David is described as a man after God's own heart despite being a warrior. The Psalms celebrate military victory as God's deliverance. The death penalty in war is not merely permitted — it is commanded.

### Step 14 — LLM synthesizes the case AGAINST biblical support

The LLM constructs the opposing argument with equal rigor:

1. **Jesus explicitly overturns retributive killing** — Matthew 5:38-44 is not a suggestion. "You have heard that it was said, 'An eye for an eye'... but I say to you, do not resist the one who is evil." Jesus directly addresses the *lex talionis* — the legal principle underlying capital punishment — and revokes it. He replaces it with love of enemies, prayer for persecutors, and nonretaliation. This isn't a marginal teaching; it's the Sermon on the Mount, the most concentrated expression of Jesus's ethical vision.

2. **Jesus demonstrates the principle** — John 8:1-11 puts Jesus in a direct capital punishment scenario. The law prescribes death for adultery. Jesus doesn't dispute the law; he reframes justice itself. "Let him who is without sin cast the first stone." The accusers leave. Jesus: "Neither do I condemn you." When given the opportunity to enforce a death penalty, Jesus refuses. His crucifixion — submitting to unjust state execution rather than calling down violence — is the ultimate embodiment of the nonviolent ethic.

3. **The earliest Christians understood this as pacifism** — For the first three centuries, the church was overwhelmingly pacifist. Tertullian: "The Lord, in disarming Peter, unbelted every soldier." Origen: Christians fight through prayer, not violence. The Didache and early church orders prohibited military service for baptized Christians. The Apostolic Tradition (c. 215) required soldiers to leave the military upon conversion. The just war tradition begins only with Constantine — when Christianity gained political power and needed to justify its use. The shift was political, not exegetical.

4. **The prophetic vision supersedes the warfare commands** — Isaiah 2:4: "They shall beat their swords into plowshares... nation shall not lift up sword against nation, neither shall they learn war anymore." Micah 4:3 echoes it. Hosea 2:18: God will "abolish the bow, the sword, and war from the land." The prophets — speaking for God — envision the *abolition* of war as God's ultimate purpose. The Old Testament warfare commands are historically bound; the prophetic vision is eschatological. Christians live in the overlap: the kingdom has been inaugurated (Jesus) but not consummated (return). The question is whether Christians should act on the warfare ethic of the old age or the peace ethic of the new.

5. **Old Testament warfare commands are descriptive, not prescriptive** — The herem commands were given to Israel for a specific conquest at a specific time. They are not repeated as universal principles. The same God who commanded the conquest also said "you shall not murder" (Exodus 20:13). David, the warrior king, was denied the honor of building God's temple *because* he was "a man of blood" (1 Chronicles 22:8) — even in the Old Testament, there is tension around violence. The narrative does not simply celebrate killing; it struggles with it.

6. **Romans 13 is not a blank check** — Paul is writing to a church in Rome under Nero — telling them to submit to the governing authority is survival advice, not an endorsement of everything the state does with the sword. Paul himself will be executed by the Roman state. The same letter (Romans 12:17-21) says: "Repay no one evil for evil... never avenge yourselves... overcome evil with good." Reading Romans 13 as divine endorsement of state killing requires ignoring the chapter immediately before it.

### Step 15 — LLM compiles the research document

The LLM now produces the final deliverable: a structured research document that will be archived to B2 and stored in the knowledge graph.

**Tool call: `remember`**

The LLM stores the completed research as a knowledge graph entity with the full analysis:

```json
{
  "tool": "remember",
  "input": {
    "type": "entity",
    "entity_type": "research_document",
    "name": "Research: Biblical basis for death penalty in war",
    "facts": [
      {
        "attribute": "status",
        "value": "complete"
      },
      {
        "attribute": "date_completed",
        "value": "2026-05-26"
      },
      {
        "attribute": "sources_archived",
        "value": "7 (Hamilton JETS article, Augustine/Aquinas lecture, early church pacifism article, Tertullian/Origen primary sources, herem hermeneutics paper, Augustine City of God Book 19, Yoder analysis)"
      },
      {
        "attribute": "key_texts_for",
        "value": "Genesis 9:6, Deuteronomy 20:10-18, Romans 13:1-4, 1 Samuel 15, Joshua 6"
      },
      {
        "attribute": "key_texts_against",
        "value": "Matthew 5:38-44, John 8:1-11, Isaiah 2:4, Micah 4:3, Hosea 2:18, Romans 12:17-21, 1 Chronicles 22:8"
      },
      {
        "attribute": "key_voices_for",
        "value": "Augustine of Hippo, Thomas Aquinas, John Calvin, Wayne Grudem"
      },
      {
        "attribute": "key_voices_against",
        "value": "Tertullian, Origen, John Howard Yoder, Stanley Hauerwas"
      }
    ]
  }
}
```

The LLM also produces the full research document text, which the agent archives to B2:

```
files/2026/05/research/2026-05-26_biblical-death-penalty-in-war-analysis.md
```

This is the primary research artifact — a self-contained document with both arguments, source citations, scripture references, and the list of archived primary sources. It gets embedded in both the active and archive partitions of `document_chunks` — active for near-term semantic search, archive for permanent retrieval.

### Step 16 — LLM updates project and delivers results

```json
{
  "tool": "manage_tasks",
  "input": {
    "action": "batch_update",
    "updates": [
      {"task_title": "Build the case FOR biblical support", "status": "done"},
      {"task_title": "Build the case AGAINST biblical support", "status": "done"},
      {"task_title": "Compile research document", "status": "done"}
    ]
  }
}
```

The project status is updated to `completed`.

### Step 17 — Telegram delivery

The LLM sends the full analysis via Telegram. For a message this long, it may split across multiple Telegram messages (Telegram's limit is 4096 characters per message). The LLM structures the output:

**Message 1 — Overview:**

*"Finished the research. I ran 8 searches, reviewed ~20 sources, and archived 7 primary sources and scholarly articles to the archive. Here's the full analysis."*

**Message 2 — The Case For:**

The steelmanned argument for biblical support, organized as a theological framework with scripture citations and source attribution. (Content from Step 13.)

**Message 3 — The Case Against:**

The steelmanned argument against biblical support, same format. (Content from Step 14.)

**Message 4 — Sources and methodology:**

*"Archived sources (available for future reference):*

*1. Hamilton, "Genesis 9:6 and the Noahic Covenant" — JETS*
*2. Augustine/Aquinas just war framework lecture*
*3. Early church pacifism in the first three centuries*
*4. Tertullian and Origen on Christian military service*
*5. Herem warfare: prescriptive vs. descriptive hermeneutics*
*6. Augustine, City of God Book 19 — just war primary text*
*7. Analysis of Yoder's Politics of Jesus*

*Full research document saved to archive. You can ask me about any of these sources or arguments anytime — they're in the knowledge graph."*

### Step 18 — Conversation persisted, audit logged

The full exchange (interim acknowledgment, research progress, final delivery) is written to the `conversations` table. The audit log records:

```sql
INSERT INTO audit_log (action, context, outcome)
VALUES ('complete_research_project',
        '{"project": "biblical basis for death penalty in war", "search_count": 8, "sources_evaluated": 20, "sources_archived": 7, "emissions_processed": 42}',
        '{"research_document": "files/2026/05/research/2026-05-26_biblical-death-penalty-in-war-analysis.md", "project_status": "completed"}');
```

---

### What's in the database after this workflow

| Table | New rows | Content |
|---|---|---|
| `projects` | 1 | "Research: biblical basis for death penalty in war" (completed) |
| `tasks` | 5 | All tasks completed |
| `entities` | 8-10 | Research document entity, 7 source entities, research project entity |
| `facts` | 30-50 | Individual findings from each source, research metadata |
| `relationships` | 8-10 | Each source → contributes_to → research project |
| `document_chunks` | 10-20 | Embedded chunks of the research document and archived sources |
| `ingestion_emissions` | 30-50 | All emissions marked `processed` |
| `processing_requests` | 8 | All search requests marked `completed` |
| `audit_log` | 3+ | Project creation, search batches, completion |
| `conversations` | ~15 | Full conversation thread |
| B2 archive | 8 files | 7 source documents + 1 research analysis document |

---

### What happens when the user asks a follow-up

**User:** *"What did Augustine actually say about killing in war? Can you pull the exact quotes?"*

The LLM receives this as a new user message. Layer 2 (daily prefix) or Layer 3 (recent prefix) contains the research project context. The LLM:

1. Calls `query_knowledge` to find the Augustine source entity and its findings
2. Calls `search_archives` to pull the embedded chunks from the archived Augustine *City of God* Book 19 document
3. Returns the relevant passages with page/section references

The archived source material makes this possible. Without archival, the agent would only have the extracted findings (summaries). With archival, it can go back to the primary text and pull exact quotes.

**User (months later):** *"We were talking about the death penalty and Scripture a while back — what sources did you find?"*

The research document entity is in the knowledge graph. The LLM queries it, finds the list of sources, and can retrieve the archived files. The full analysis is in `document_chunks` and searchable semantically. The research survives compaction, pruning, and time — the knowledge graph facts persist, the archive is permanent.

---

### Timing and cost

**Wall clock time:** 3-7 minutes. The bottleneck is the three rounds of web search (Steps 6, 10, 11), each requiring a round trip through the ingestion container: the agent inserts processing requests → ingestion polls (5-10 seconds) → ingestion runs searches and processes results (10-30 seconds per search) → ingestion emits findings → the agent polls emissions (5-10 seconds) → the agent processes and returns to LLM.

Each round involves 2-3 searches running sequentially in ingestion. With three rounds, that's ~8 searches × ~20 seconds average = ~160 seconds in search time, plus polling overhead and LLM reasoning between rounds.

**Cost breakdown (approximate):**

| Component | Cost |
|---|---|
| Agent LLM (Sonnet, ~6 turns of reasoning) | $0.10-0.20 |
| Ingestion LLM (Haiku, ~20 pages processed) | $0.02-0.05 |
| Anthropic web search (8 searches) | $0.08-0.16 |
| Embeddings (research doc + source chunks) | $0.001 |
| B2 storage (8 files, ~2MB total) | $0.0001/month |
| **Total** | **~$0.20-0.40** |

This is expensive relative to a simple query ($0.01-0.03) but cheap for the output: a structured research document with opposing arguments, 7 archived primary sources, and a knowledge graph populated with 30-50 attributed findings that persist indefinitely.

---

### Schema observations

#### The `research_finding` emission type

The existing emission types (`entity`, `fact`, `relationship`, `event`, `transaction`, `embedding_chunk`) don't cleanly accommodate research findings. A finding is richer than a fact — it has a claim, scripture references, a position (for/against/contextual), and a source quality rating. Shoehorning this into the `fact` type would lose the structure.

Options:

1. **Add `research_finding` as a new emission type.** Payload schema includes `source_title`, `source_quality`, `findings[]` with structured claims. The agent processes these into entity + fact + relationship records. This is the cleanest approach.

2. **Use the existing types and have ingestion emit multiple records per source.** One `entity` emission for the source, multiple `fact` emissions for findings, `relationship` emissions linking source to project. This works but forces ingestion to understand the knowledge graph schema more deeply.

**Decision:** option 1. The ingestion container emits a single `research_finding` per source, and the agent's emission processor decomposes it into the appropriate knowledge graph records. This keeps ingestion simple (emit what you found) and the agent smart (decide how to store it).

#### Research projects vs. regular projects

Research projects have a different lifecycle from projects like "file my taxes." They're burst work — created and completed in a single session, not tracked over weeks. The `surfacing_policy: "on_demand"` handles this, but there's a question about whether the project entity should be tagged differently for the daily briefing to skip it.

Currently, completed projects are excluded from the daily briefing by status alone (`status = 'completed'`). This is sufficient — no schema change needed.

#### Multi-round search coordination

The workflow requires three sequential rounds of web search, with the LLM reviewing findings between rounds to identify gaps. This means the tool loop (LLM → tool call → result → LLM → next tool call) needs to survive across multiple ingestion round trips.

The risk is context growth: by the third round, the LLM has accumulated findings from two prior rounds in its context. If each round produces ~15 emissions with detailed findings, the raw context could exceed the token budget.

Mitigation: the `query_knowledge` tool returns formatted summaries of stored findings, not the raw emissions. The LLM doesn't need the full text of every emission in its context — it needs a structured summary of what's been found and what's missing. The tool's application code handles the summarization, keeping the token budget manageable.

If the research is so extensive that even the summaries exceed the context budget, compaction fires mid-research: the LLM's findings-so-far are extracted to the knowledge graph, the raw conversation is truncated, and the LLM continues with the condensed context in Layer 3. The research isn't lost — it's in the knowledge graph, retrievable via `query_knowledge`.

#### Source quality as a first-class attribute

The workflow relies heavily on the ingestion LLM's judgment about source quality (`high`, `medium`, `low`). This judgment determines:

- Whether a source is archived to B2 (substantive sources only)
- How the source's findings are weighted in the final synthesis
- What the user sees in the source list

There's no hard rule for source quality — it's the ingestion LLM's judgment based on publication venue, author credentials, content depth, and citation patterns. The system prompt for the ingestion LLM should include guidance:

- **High:** peer-reviewed journals, university press books, primary texts (church fathers, Scripture), published by recognized scholars
- **Medium:** seminary course materials, theological dictionaries, respected denominational publications, well-cited analyses
- **Low:** blog posts, opinion pieces, anonymous web content, SEO-driven articles

The quality rating is stored in the source entity's properties and visible to both the agent LLM (for synthesis) and the user (for source evaluation).

#### The archive is the insurance policy

If the LLM misinterprets a source, extracts the wrong finding, or makes a reasoning error in the synthesis — the archived PDFs are there. The user can read the original sources. The knowledge graph can be corrected and the research document regenerated. The archive is append-only and permanent; the extracted findings are just a cache of what's in the sources.

This is the same principle as the financial workflow: the original CSV or receipt image is the source of truth, and the database records are derived from it. Here, the original scholarly articles are the source of truth, and the knowledge graph findings are derived from them.
