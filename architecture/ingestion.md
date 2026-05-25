# Ingestion

What data comes into the assistant, what doesn't, and how it gets in. Implements the "senses" primitive from [primitives.md](primitives.md). Per-source processing pipelines (what happens *after* ingestion) live in [data-lifecycle.md](data-lifecycle.md).

## The work data rule

**The assistant does not touch work data. Full stop.**

Company data on company systems is subject to employment agreements, acceptable use policies, and potentially industry regulations. Pointing a personal AI assistant at work Gmail, Slack, or Zoom recordings is unauthorized exfiltration of company data — regardless of how well-secured the personal server is. If a breach occurs and company data is found on your personal VPS, it is a career-ending discovery.

**The distinction:** the assistant can be aware of work's *impact on your life* without ingesting work's *content*.

- ❌ *"Your VP sent an email about restructuring. Here's a summary of the options."*
- ✅ *"You have 6 meetings tomorrow between 9 and 4 with no lunch break. Your 2pm is a one-on-one with your manager — you wanted to discuss the raise."*

This is principle #5 in [vision.md](vision.md), enforced at the integration layer.

## Input channel map

| Source | Integration type | What's captured | What's excluded |
|---|---|---|---|
| **Personal Gmail** (custom domain) | Fully automated (OAuth, read-only) | Full pipeline: archive, triage, summarize, embed, knowledge graph | Security-sensitive emails filtered out — see [security.md](security.md) |
| **Work Gmail** | NOT integrated | Nothing automated | Everything. Manually forward personal-relevant items to personal email when appropriate |
| **Personal Google Calendar** | Fully automated (read-only) | Events feed scheduling engine | — |
| **Work Google Calendar** | Semi-automated (read-only share) | Free/busy or basic event details (times, titles) for unified schedule view. Shared to personal Google account, not accessed via work credentials | Meeting content, attachments, notes |
| **Personal Google Drive** | Fully automated (read-only OAuth) | Documents archived and ingested | — |
| **Work Google Drive / file systems** | NOT integrated | Nothing | Everything |
| **Work Slack** | NOT integrated | Nothing | Everything |
| **iMessage** | Manual capture | Screenshots or copy-paste of specific conversations via quick-capture channel | No automated ingestion (no clean API; Apple actively prevents it) |
| **WhatsApp** | Periodic manual export | Chat history text files for important conversations, batch-ingested | No real-time integration |
| **Signal** | Not integrated | Nothing (by design — Signal conversations are meant to be ephemeral) | Everything |
| **Telegram** | Potentially automated (has full API) | Messages from personal conversations | — |
| **Discord** | Potentially automated (gray area) | Read-only personal server messages | — |
| **Physical mail** | Photo capture → OCR | Photos sent to quick-capture bot. OCR extracts text, classifies (bill, legal doc, personal letter), extracts structured data | — |
| **Meeting takeaways** | Voice memo capture | 60-second post-meeting voice note, transcribed via Whisper API | No recording of actual meetings. Your observations and takeaways only |
| **Conversations with the assistant** | Always on | Every message you send is scanned for entities, facts, tasks, intentions, and preferences — extracted to knowledge graph in real time | Routine queries pruned after 1 month; see [data-lifecycle.md](data-lifecycle.md) |
| **Zoom/Slack/Google Meet recordings** | NOT integrated (work data) | Nothing | Everything |

## Quick-capture channels

For data sources that can't or shouldn't be automated, three frictionless input methods:

1. **Telegram bot** (or simple mobile-friendly web form behind VPN). Pull out phone, type or dictate a note or task. *"Met with James from client team, he mentioned contract renews in September."* The assistant ingests this as a first-person note, extracts entities and facts. Also the primary interface for creating and managing tasks: *"Add a task: research lumber options for the dog house project."*
2. **Photo capture.** Take a photo of physical mail, send to bot. System OCRs it, classifies it, extracts structured data, archives the original photo.
3. **Voice memos.** After a meeting or conversation, record a brief voice note. System transcribes (Whisper API), processes content. Supports annotations: *"Dave mentioned he's leaving — told me in confidence, don't surface this."*

**The key principle for work data:** you are the filter. You capture your own observations, feelings, plans, and takeaways — those are yours. The company's documents, messages, and recordings are theirs.

The Telegram bot is also the primary inbound interface during the prototype phase — see [interfaces.md](interfaces.md).

**Architectural constraint:** the ingestion pipeline processes untrusted external content (emails from anyone, OCR'd mail, documents). It runs as a separate agent from the action/reasoning layer, with restricted tool permissions — it can write to database tables but cannot draft replies, send messages, or trigger actions. This prevents prompt injection in ingested content from causing unintended side effects. See [security.md](security.md).

## Sensitivity tagging

Every stored item gets a sensitivity classification:

- **Personal.** Purely your own life. Assistant reasons freely.
- **Work-adjacent.** Your observations about work situations, career plans, colleague relationship notes. Assistant reasons about it but is conservative in surfacing — shouldn't generate output that reads like a company document.
- **Confidential.** Things told to you in confidence, sensitive information. System stores for your reference but never proactively surfaces. Requires explicit queries to retrieve.

Sensitivity tags are honored by the [reasoning layer](primitives.md) when deciding what to surface proactively, and by the storage layer when deciding what gets the second-factor-encrypted partition (see [security.md](security.md)).
