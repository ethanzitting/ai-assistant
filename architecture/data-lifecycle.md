# Data Lifecycle

How data ages: ingested at full fidelity, compressed as it gets older, eventually distilled to facts in the knowledge graph. Sister doc to [data-architecture.md](data-architecture.md), which covers where data *lives*; this doc covers what happens to it *over time*.

The archive (object storage) sits outside this lifecycle — originals are retained forever there. What follows is about the active/working storage.

## Three-tier memory model

| Tier | Age | What's stored |
|---|---|---|
| **Hot** | 0–2 weeks | Full-fidelity recent data, stored verbatim |
| **Warm** | 2 weeks – 6 months | Summarized and distilled. Individual items compressed into meaningful takeaways, raw text deleted |
| **Cold** | 6+ months | Knowledge graph facts only. Extracted relationships, patterns, decisions — no source material attached. Tiny and structurally important |

Data flows downward through tiers over time, getting smaller and denser. The archive retains originals at full fidelity outside this tier system.

## Processing by data type

Different data types follow different lifecycles. The pruning engine (below) routes each type through the right pipeline.

### Emails

1. **Triage classification** (rule-based + lightweight LLM):
   - *Security-sensitive* (2FA, password resets): Immediately discarded, never stored. See [security.md](security.md) for why this is non-negotiable.
   - *Transactional noise* (shipping, receipts, automated notifications): Extract structured data (tracking number, arrival date), write to event system, discard body.
   - *Informational* (newsletters, announcements): Generate 2-3 sentence summary, extract dates/action items, embed summary, discard original body.
   - *Relational* (human communication): Full processing — hot storage of full text, entity/fact extraction for knowledge graph, embedding generation.
2. **Pruning at 2 weeks:** LLM summarization pass. Summary replaces full text. Embedding regenerated from summary.
3. **Pruning at 6 months:** Further compression into periodic summary documents (*"March 2026: contractor confirmed start date, insurance claim approved"*). Individual summary deleted; insight absorbed into periodic summary. Knowledge graph facts persist indefinitely.

### PDFs and documents

- **Legal/financial** (contracts, tax forms, insurance): Stored permanently in archive. Key metadata extracted to structured storage. Deadlines fed to event engine. Never pruned.
- **Reference** (manuals, guides, research): Chunked and embedded for vector search. Original kept in archive. If not retrieved in queries for 1+ year, active-index chunks can be pruned.
- **Ephemeral** (menus, flyers, one-time informational): Extract dates/facts, push to event engine/knowledge graph, discard from active storage after short retention. Archive retains original.

### Voice memos and notes

These are your own after-the-fact captures — a 60-second voice note after a meeting, a typed note in the Telegram bot. Not recordings of conversations.

1. **Immediate structured extraction** (high-value LLM call):
   - Summary (high-level overview)
   - Action items (who committed to what, by when)
   - Decisions made (anything agreed upon)
   - Key facts and entity updates
2. Action items → task/event system. Decisions → decisions log. Entity updates → knowledge graph. Summary + full text → embedded for vector search.
3. **Pruning at 1 month:** Compressed summary generated. Verify all action items and decisions already extracted. Delete full text from active storage.
4. **Pruning at 6 months:** Compressed summary folded into periodic summary. Individual summary deleted. Action items and decisions persist as standalone records.

### LLM interaction logs

1. Full interaction logged: query, assembled context, prompt, response, feedback.
2. **Pruning at 1 month:** Classify each interaction. Discard routine ones (*"what's on my calendar today?"*). Keep interactions containing preference signals, corrections, or substantive decisions.
3. **Preference distillation:** Preference-bearing interactions converted to explicit preference records in the knowledge graph (*"User prefers not to be reminded about gym on weekends, established May 2026"*). Raw conversation deleted; preference is the durable artifact. This feeds the preference & feedback loop primitive in [primitives.md](primitives.md).

## Pruning engine

A scheduled weekly/biweekly job:

1. Scan hot storage for items older than retention window.
2. Check data type, apply appropriate summarization strategy.
3. Run LLM summarization, write compressed version to warm storage, update embeddings.
4. Verify structured extractions exist in knowledge graph.
5. Move originals to "pending deletion" state (1-week grace period for recovery).
6. Purge after grace period.

A separate monthly job handles warm → cold transitions and periodic summary aggregation.

### Token economics

Summarizing one email costs ~1,000-2,000 tokens. At 50 meaningful emails/week, that's ~100K tokens/week — a few cents. Transcript summarization is more expensive but infrequent. **Total pruning pipeline cost: ~$1-3/month in API calls.**
