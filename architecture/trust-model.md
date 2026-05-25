# Trust & Autonomy Model

How much authority the assistant has to act on its own. Every feature in [vision.md](vision.md) is categorized into one of three tiers. The tier dictates what the assistant is allowed to do *without* asking — and where that authority is enforced architecturally lives in [ingestion.md](ingestion.md) (read scope) and [security.md](security.md) (write scope and credentials).

## Tier 1 — Observe & Inform

**Default for all features at launch.**

The assistant watches, tracks, analyzes, and tells you things. Zero risk. Covers reminders, information surfacing, pattern recognition, deadline tracking, briefings.

Architecturally: integrations are read-only OAuth scopes. No send-as, no write-back, no booking.

## Tier 2 — Draft & Propose

The assistant prepares actions for your approval. Email drafts, itinerary options, comparison research, meeting prep docs. You pull the trigger.

Architecturally: the assistant can compose, queue, and present, but a human action (button press, voice confirm, signed approval) is required to actually send/book/commit.

## Tier 3 — Act Autonomously

**Future — requires earned trust.**

The assistant schedules, sends messages, or takes actions on your behalf. Limited to low-stakes actions initially (confirming appointments, sending pre-approved messages). No financial transactions without explicit per-action approval.

Architecturally: this tier requires write-scoped credentials, stricter audit logging, and reversibility paths for anything it does autonomously.

## How tiers move

A capability is promoted from Tier 1 → Tier 2 → Tier 3 only after:
1. It has been running reliably at the lower tier for long enough to build confidence.
2. The failure mode at the next tier is understood and bounded.
3. There is a documented rollback for anything it might do wrong.

There is no global "graduate the assistant" — promotions are per-capability.

## Runtime enforcement

Trust tiers are *policy*. The runtime controls in [security.md](security.md) are the *mechanism* that enforces them:

- **Circuit breakers** enforce budget caps, rate limits, and scope allowlists on every tool call. The scope allowlist is derived from the tier — a Tier 1 capability has read-only tools available; a Tier 2 capability adds draft/queue tools.
- **Kill switch** freezes all agent activity. Executable from a phone.
- **Graceful degradation** dynamically drops a capability back to a lower tier if anomalous behavior is detected — the system reverts to Tier 1 (read-only) rather than shutting down entirely.
