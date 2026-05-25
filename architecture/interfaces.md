# Interfaces

How the assistant talks to you and how you talk back. Implements the "voice" primitive from [primitives.md](primitives.md).

This doc covers two horizons:

- **Prototype I/O.** The cheap, available-today setup. What you actually start with.
- **Target I/O.** The end-state including the Even Realities G2 smart glasses.

The prototype-first strategy is deliberate: don't spend $850 on glasses to test an assistant that doesn't exist yet.

## Prototype I/O — start here

> **Decision:** Defer the G2 purchase until the system proves its value. Simulate the experience with hardware you already own.

### Recommended starting setup

**Hardware:** iPhone + any Bluetooth earbuds with a mic (AirPods or whatever you have).

**Notification channel:** Pushover ($5 one-time, dead-simple HTTP API, supports Apple Watch complications) or ntfy (free, self-hosted, open source). Your server pushes notifications with priority levels straight to your phone lock screen.

**Voice I/O channel:** Telegram bot. You already need this for quick-capture (see [ingestion.md](ingestion.md)). Talk into Telegram via earbuds (native voice message support), bot receives audio, transcribes via Whisper API, processes through assistant, replies as text in the same chat. One app, one channel, works on day one.

**Optional alternative — Siri Shortcut:** A shortcut called "Hey assistant" that records audio, hits your server's API, and speaks the response via text-to-speech. Triggered by "Hey Siri, assistant" or AirPod tap. No app needed.

**Optional hardware upgrades (cheap):**

- Used Apple Watch SE/Series 5 ($80-120): Glanceable wrist display for notifications. Telegram has a native watch app with voice message support. Closest analog to the G2 HUD experience.
- Bluetooth push-to-talk button ($10-15): Clip-on shutter remote reprogrammed via iOS Shortcuts to trigger voice capture. Physical "talk to assistant" button without saying "Hey Siri" in public.

### Key search queries for implementation

- `"Telegram bot voice message webhook Python"` — receiving and processing voice input
- `"Pushover API send notification from server"` — one-line curl to push alerts
- `"ntfy self-hosted push notifications iPhone"` — free Pushover alternative
- `"Siri Shortcut record audio send to API endpoint"` — voice capture via Siri
- `"iOS Shortcuts whisper API transcription"` — server-side transcription option

### Upgrade trigger

Buy the Even Realities G2 + R1 ring when all three are true:

1. The assistant is running and producing daily value.
2. You're consistently annoyed by pulling out your phone to read notifications.
3. You have a clear picture of what notification types belong on a HUD vs. phone vs. desktop.

### Cost comparison

| Setup | Cost |
|---|---|
| Earbuds you own + Telegram + Pushover | $0–5 |
| Add used Apple Watch | $80–120 |
| Add Bluetooth button | $10–15 |
| **Prototype total** | **$5–140** |
| Even Realities G2 + R1 ring | ~$850 |

## Target I/O — Even Realities G2

The G2 smart glasses are a high-priority output device for the assistant — not a novelty but a fundamentally better channel for ~80% of proactive notifications.

### Key specs

- No camera, no speakers — privacy-first design. Just a green micro-LED HUD display.
- 36g weight, looks like regular glasses. Available with prescription lenses (-12.00 to +12.00).
- 2-day battery life. Charging case provides 7 additional charges (~2 weeks without plugging in).
- $599 for glasses. R1 companion ring ($249) provides tap/slide/press input.
- Bluetooth 5.2 connection to phone. All processing happens on the companion app/phone.

### Developer ecosystem

- Even Hub: open developer platform with SDK and APIs (launched April 2026).
- React-based app templates (minimal, ASR, image, text-heavy).
- 55+ web components in official design system.
- Speech-to-text module built in.
- Community BLE protocol reverse-engineering project for direct Python control.
- Official developer docs for plugins, dashboard widgets, and AI integrations.

**Privacy:** no data stored in cloud without explicit consent. Processing is encrypted with PII removed.

## Multi-channel output architecture

The communication interface layer classifies every outbound notification by:

- **Urgency.** Immediate, next-available-glance, can-wait.
- **Length.** One-liner, short paragraph, full document.
- **Context-sensitivity.** Location-aware, meeting-aware, activity-aware.

| Channel | Best for | Examples |
|---|---|---|
| **G2 glasses** | Short, timely, contextual nudges | Relationship reminders, calendar awareness, financial alerts, navigation, meeting prep one-liners |
| **Phone (Telegram bot / app)** | Richer interactions, drafts for review, summaries requiring action | Email triage summaries, drafted replies, comparison research, multi-paragraph briefings |
| **Desktop** | Full working sessions, document review, deep research | Complete morning briefings, financial analysis, document management, system administration |

**Key UX insight:** a phone buzz is an interruption. A line of green text in your peripheral vision is an *option*. The glasses allow the assistant to push information proactively without being intrusive — the user chooses when to glance at it. This is principle #8 in [vision.md](vision.md).

## G2 integration path

Build an Even Hub app that serves as a thin client for the assistant:

1. Assistant server decides something is worth surfacing.
2. Pushes notification to companion app on phone (over VPN — see [security.md](security.md)).
3. App formats content for G2's green monochrome HUD.
4. Glasses display it in peripheral vision.

R1 ring enables quick input: tap to trigger voice capture that goes directly to the assistant's ingestion pipeline, replacing the need to pull out your phone for the Telegram bot in many cases.

Conversate transcription feature can pipe meeting summaries into the ingestion pipeline for personal (non-work) conversations — solving the meeting-takeaway capture problem passively. See [ingestion.md](ingestion.md) for the work-data boundary that still applies.
