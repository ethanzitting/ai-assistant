# Risks & Open Issues

Architectural review of the planning docs. Covers contradictions between documents, unrealistic assumptions, underspecified mechanisms, and single points of failure. Each finding references the source doc so it can be resolved in place.

## Architectural risks

### LLM API access in ingestion undermines isolation

The ingestion container needs LLM API access for email triage classification. But [security.md](security.md) identifies LLM API calls as a "data exfiltration channel." The ingestion container processes untrusted content *and* can make LLM API calls — a compromised ingestion container could embed exfiltrated data in LLM API prompts.

> **Partial resolution (2026-05-25):** Web search now routes through ingestion rather than core, which means core never processes untrusted external content directly — a significant improvement. The residual risk is that ingestion's LLM API calls (for email triage and web search processing) are themselves an exfiltration channel. Mitigated by: zero-retention on the LLM API, rate limiting on ingestion LLM calls, and the fact that an attacker must first compromise the container. Accepted as a known residual risk.

### LUKS encryption vs. unattended reboot

[security.md](security.md) says database volumes are LUKS-encrypted with the decryption key "fetched from a separate service at boot time." If the VPS reboots for host maintenance (common on Hetzner/DigitalOcean), the system must either:

1. **Decrypt automatically** — the remote key service becomes a single point of compromise. An attacker who gets the VPS and the key service has everything.
2. **Require manual intervention** — the system is down until you notice and act. Could be hours.

Neither behavior is specified. This is a known tension in LUKS setups that needs a deliberate decision.

### No LLM fallback

The entire system — daily briefings, email triage, entity extraction, compaction, pattern recognition, calendar conflict detection — depends on LLM API availability. No degraded mode is discussed.

Several features could work without LLM calls: bill due date alerts (database query), calendar conflicts (time overlap check), simple reminders (event engine), and task surfacing (database query + surfacing policy). These should function even during an API outage.

> **Recommendation:** Identify which features are LLM-dependent vs. rule-based. Build the rule-based ones to work independently so the system degrades gracefully instead of going fully dark.

### Kill switch 1Password polling

[security.md](security.md) says the kill switch is "a key in 1Password that the tool-call middleware checks before every execution." This adds a network round-trip to 1Password on every tool call. Two unresolved questions:

1. **Latency.** Every tool call blocks on a 1Password API call.
2. **Failure mode.** If 1Password is unreachable, does the system fail-open (security risk) or fail-closed (availability risk)?

> **Recommendation:** Cache the kill switch state locally with a short TTL (e.g., 60 seconds). Check 1Password periodically, not per-call. Fail-closed on unreachable — better to pause than to run without a kill switch.

## Questionable feasibility

### Work calendar sharing depends on org policy

[ingestion.md](ingestion.md) plans to share the work calendar to a personal Google account. Many organizations restrict external calendar sharing in Google Workspace admin settings. If the org blocks this, the unified schedule view breaks with no fallback mentioned.

> **Recommendation:** Document the fallback: manual ICS export, a browser extension that scrapes free/busy, or simply accepting that work calendar integration may not be available.

### "Nuke and rebuild from archive" is expensive

Multiple docs reference the ability to "nuke the knowledge graph tables and rebuild from the archive" as a safety net. Rebuilding means re-running the full LLM extraction pipeline over every archived file — potentially years of emails, documents, and conversation logs. At current API pricing, this could cost hundreds of dollars and take days. It's a theoretical safety net, not a practical one for routine recovery.

> **Recommendation:** Acknowledge the cost in the docs. Rely on the weekly knowledge snapshots for practical rollback, and reserve the full rebuild for catastrophic scenarios. Consider incremental rebuild (re-process only data since the last known-good snapshot).

## Underspecified mechanisms

### How core discovers new ingestion emissions

The ingestion container INSERTs into `ingestion_emissions`. Core needs to process these. The mechanism is not specified — LISTEN/NOTIFY, polling, triggers? This affects latency (how long between email arrival and agent awareness) and implementation complexity.

### Silent context injection latency budget

[context-assembly.md](context-assembly.md) says before every response, the agent queries for new entries since the last turn. Combined with the 1Password kill switch check and query-specific RAG retrieval, every user message triggers multiple DB queries + network calls before the LLM call starts. The total latency budget for this pre-fetch step is not discussed.

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
| **Low** | Document work calendar fallback if org blocks sharing | [ingestion.md](ingestion.md) |
| **Low** | Revise cost estimates with model tier assumptions | [infrastructure.md](infrastructure.md) |
| **Low** | Drop Plaid or document the ToS workaround | [roadmap.md](roadmap.md) |
| **Low** | Fix quick-capture count (three vs. four) | [ingestion.md](ingestion.md) |
