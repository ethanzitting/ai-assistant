### How core discovers new ingestion emissions

The ingestion container INSERTs into `ingestion_emissions`. Core needs to process these. The mechanism is not specified — LISTEN/NOTIFY, polling, triggers? This affects latency (how long between email arrival and agent awareness) and implementation complexity.



## Cost estimate risks

The [$10-30/month LLM estimate](infrastructure.md) likely underestimates actual usage:

- 50 emails/week x ~2K tokens each for triage + summarization = ~100K tokens/week for email alone
- Daily briefing with 4K+ token assembled context
- Compaction passes (LLM extraction from conversation)
- Weekly pruning (LLM summarization)
- Voice memo processing
- Research flows with multi-turn reasoning
- Proactive pattern recognition (Month 3) with regular analysis sweeps

With Claude Sonnet this might hold. With Opus-class models for the reasoning layer, $30/month is optimistic. The estimate should specify which model tier it assumes and include a pessimistic scenario.
