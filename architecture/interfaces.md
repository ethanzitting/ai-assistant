# Interfaces

How the assistant talks to you and how you talk back. Implements the "voice" primitive from [primitives.md](primitives.md).

The target channels are **Telegram**, **smartwatch**, and **AirPods** — things you already own or can get cheaply. Smart glasses (Even Realities G2) are a future upgrade, contingent on the system proving real daily value first.

## Primary setup

**Hardware:** iPhone + AirPods (or any Bluetooth earbuds with a mic).

**Notification channel:** Pushover ($5 one-time, dead-simple HTTP API, supports Apple Watch complications) or ntfy (free, self-hosted, open source). Your server pushes notifications with priority levels straight to your phone lock screen.

**Voice I/O channel:** Telegram bot. You already need this for quick-capture (see [ingestion.md](ingestion.md)). Talk into Telegram via earbuds (native voice message support), bot receives audio, transcribes via Whisper API, processes through assistant, replies as text in the same chat. One app, one channel, works on day one.

**Optional alternative — Siri Shortcut:** A shortcut called "Hey assistant" that records audio, sends it as a Telegram voice message to the bot, and speaks the response via text-to-speech. Triggered by "Hey Siri, assistant" or AirPod tap. No app needed, no exposed server endpoints — everything flows through Telegram's API.

**Recommended hardware additions:**

- Apple Watch SE/Series 5 ($80-120): Glanceable wrist display for notifications. Telegram has a native watch app with voice message support. The closest thing to a HUD without glasses.
- Bluetooth push-to-talk button ($10-15): Clip-on shutter remote reprogrammed via iOS Shortcuts to trigger voice capture. Physical "talk to assistant" button without saying "Hey Siri" in public.

### Key search queries for implementation

- `"Telegram bot long polling Python"` — receiving and processing messages without webhooks
- `"Telegram bot voice message Python"` — handling voice input via Telegram
- `"Pushover API send notification from server"` — one-line curl to push alerts
- `"ntfy self-hosted push notifications iPhone"` — free Pushover alternative
- `"Siri Shortcut send Telegram message"` — voice capture via Siri routed through Telegram

### Cost

| Setup | Cost |
|---|---|
| Earbuds you own + Telegram + Pushover | $0–5 |
| Add Apple Watch | $80–120 |
| Add Bluetooth button | $10–15 |
| **Total** | **$5–140** |

## SSH CLI

The server is always accessible via SSH over WireGuard. A CLI tool on the server exposes the full set of agent operations — querying the knowledge graph, managing tasks, triggering briefings, inspecting logs, and running diagnostics. This is the admin interface and the fallback when Telegram is unavailable.

Key commands available on the CLI include:
- **Kill switch.** Immediately halt all agent tool execution.
- **Read-only mode.** Reduce agent permissions to observe-only.
- **Status.** Show agent state, recent actions, emission queue depth, circuit breaker status.
- **Query.** Run a question through the full context assembly and reasoning pipeline.
- **Briefing.** Trigger a daily briefing on demand.
- **Task management.** Create, list, update, and resolve tasks and projects.
- **Knowledge graph.** Inspect entities, facts, and relationships directly.
- **Logs.** Tail agent activity, audit log, and anomaly alerts.

This is not a secondary interface — it's the most powerful one. Telegram is the convenient mobile channel; SSH is where you operate and debug the system.

## Multi-channel output architecture

The communication interface layer classifies every outbound notification by:

- **Urgency.** Immediate, next-available-glance, can-wait.
- **Length.** One-liner, short paragraph, full document.
- **Context-sensitivity.** Location-aware, meeting-aware, activity-aware.

| Channel | Best for | Examples |
|---|---|---|
| **Smartwatch** | Short, timely, contextual nudges | Calendar reminders, financial alerts, meeting prep one-liners |
| **Phone (Telegram bot)** | Richer interactions, drafts for review, summaries requiring action | Email triage summaries, drafted replies, comparison research, multi-paragraph briefings |
| **AirPods (Siri Shortcut)** | Hands-free Q&A, spoken briefings | Morning briefing while getting ready, quick queries while driving |
| **SSH CLI** | Admin operations, diagnostics, fallback interaction | Kill switch, system status, knowledge graph inspection, task management, on-demand briefings |
| **Desktop** | Full working sessions, document review, deep research | Complete morning briefings, financial analysis, document management, system administration |

**Key UX insight:** matching the channel to the message matters more than the channel itself. A watch tap for a one-liner, a Telegram message for something you need to read, a spoken response when your hands are busy. See principle #8 in [vision.md](vision.md).

**Mid-day event surfacing:** when something important happens between daily prefix rebuilds (an urgent email, a calendar change, a financial alert), the agent surfaces it via proactive notification on the appropriate channel. This notification becomes part of the conversation stream, keeping the agent's context current without rebuilding cached prompt layers. Less urgent events are picked up silently on the next user interaction. See [context-assembly.md](context-assembly.md) for the full model.

## Future: smart glasses

The Even Realities G2 ($599 + $249 R1 ring) is the eventual upgrade path — a green micro-LED HUD in regular-looking glasses. Privacy-first (no camera, no speakers), 36g, prescription-compatible. Even Hub provides an open developer SDK.

**Upgrade trigger:** buy when all three are true:

1. The assistant is running and producing daily value.
2. You're consistently annoyed by pulling out your phone to read notifications.
3. You have a clear picture of what notification types belong on a HUD vs. watch vs. phone.

The multi-channel output architecture above is designed so adding a glasses channel later is just another row in the routing table, not an architectural change.
