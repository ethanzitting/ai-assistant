# Risks & Open Issues

Architectural review of the planning docs. Covers contradictions between documents, unrealistic assumptions, underspecified mechanisms, and single points of failure. Each finding references the source doc so it can be resolved in place.

## Architectural risks

### LUKS encryption vs. unattended reboot

[security.md](security.md) says database volumes are LUKS-encrypted with the decryption key "fetched from a separate service at boot time." If the VPS reboots for host maintenance (common on Hetzner/DigitalOcean), the system must either:

1. **Decrypt automatically** — the remote key service becomes a single point of compromise. An attacker who gets the VPS and the key service has everything.
2. **Require manual intervention** — the system is down until you notice and act. Could be hours.

Neither behavior is specified. This is a known tension in LUKS setups that needs a deliberate decision.

## Questionable feasibility

### "Nuke and rebuild from archive" is expensive

Multiple docs reference the ability to "nuke the knowledge graph tables and rebuild from the archive" as a safety net. Rebuilding means re-running the full LLM extraction pipeline over every archived file — potentially years of emails, documents, and conversation logs. At current API pricing, this could cost hundreds of dollars and take days. It's a theoretical safety net, not a practical one for routine recovery.

> **Recommendation:** Acknowledge the cost in the docs. Rely on the weekly knowledge snapshots for practical rollback, and reserve the full rebuild for catastrophic scenarios. Consider incremental rebuild (re-process only data since the last known-good snapshot).

## Underspecified mechanisms

### How core discovers new ingestion emissions

The ingestion container INSERTs into `ingestion_emissions`. Core needs to process these. The mechanism is not specified — LISTEN/NOTIFY, polling, triggers? This affects latency (how long between email arrival and agent awareness) and implementation complexity.


### High-impact vs. low-stakes boundary

[infrastructure.md](infrastructure.md) says high-impact knowledge graph changes go to a review queue while low-stakes updates write directly. The boundary is never defined. Without a clear rule, the implementation will either be too conservative (everything queued, user overwhelmed with review items) or too permissive (bad extractions written silently).

> **Recommendation:** Define the boundary explicitly. Candidates for review queue: entity merges, relationship type changes, financial fact updates, contact deletions. Candidates for direct write: new entity creation from email, calendar event facts, task status updates.

### Core language undecided

[infrastructure.md](infrastructure.md) says Core and Ingestion are "(Python or Node)." [tech-stack.md](tech-stack.md) learning resources are Python-oriented. This decision affects library choices, async patterns, deployment, and everything downstream. It should be resolved before Month 1 starts.

### File store provider undecided

[data-architecture.md](data-architecture.md) lists "Google Drive, GCS bucket, or S3/Backblaze B2" for the file store. This affects how ingestion stores files, how the sandbox reads files, backup strategy, and cost. The choice between a user-facing file system (Google Drive) and an API-only object store (B2/S3) has significant UX implications.

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

## Summary of action items

| Priority | Item | Where to fix |
|---|---|---|
| **High** | Scope the append-only principle or rewrite lifecycle language | [vision.md](vision.md), [data-lifecycle.md](data-lifecycle.md) |
| ~~**High**~~ | ~~Split web fetching out of the ingestion container, or restrict it to user-initiated requests only~~ — **Resolved:** web search routes through ingestion, user-initiated only, core never processes untrusted content | [security.md](security.md), [ingestion.md](ingestion.md) |
| **High** | Decide core language (Python or Node) | [infrastructure.md](infrastructure.md), [tech-stack.md](tech-stack.md) |
| **High** | Rebase timelines to 2-3x current estimates | [roadmap.md](roadmap.md) |
| **Medium** | Decide LUKS reboot behavior | [security.md](security.md) |
| **Medium** | Decide kill switch failure mode and caching strategy | [security.md](security.md) |
| **Medium** | Define high-impact vs. low-stakes boundary for knowledge graph writes | [infrastructure.md](infrastructure.md) |
| **Medium** | Specify emission discovery mechanism (polling, LISTEN/NOTIFY, etc.) | [security.md](security.md), [infrastructure.md](infrastructure.md) |
| **Medium** | Add a non-Telegram fallback interface | [interfaces.md](interfaces.md) |
| **Medium** | Decide file store provider | [data-architecture.md](data-architecture.md) |
| **Medium** | Test gVisor ptrace compatibility with target Python libraries | [infrastructure.md](infrastructure.md) |
| **Low** | Identify LLM-independent features and build rule-based fallbacks | [primitives.md](primitives.md) |
| **Low** | Revise cost estimates with model tier assumptions | [infrastructure.md](infrastructure.md) |
| **Low** | Drop Plaid or document the ToS workaround | [roadmap.md](roadmap.md) |
| **Low** | Fix quick-capture count (three vs. four) | [ingestion.md](ingestion.md) |
