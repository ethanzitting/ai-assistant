# Trust & Autonomy Model

A development philosophy for how the assistant's capabilities expand over time. These tiers guide what gets built and when — they are **not** a runtime permission system. The code doesn't know about tiers; each tier simply describes a phase of development. When the current phase is working well and generating real value, new capabilities are added.

## Phase 1 — Observe & Inform

**What we're building first.**

The assistant watches, tracks, analyzes, and tells you things. Covers reminders, information surfacing, pattern recognition, deadline tracking, research, analysis, briefings. This phase alone delivers the core value proposition — reducing cognitive overhead by connecting dots across domains you can't hold in your head.

Integrations are read-only. No send-as, no write-back, no booking.

## Phase 2 — Draft & Propose

The assistant prepares actions for your approval. Email drafts, comparison research, meeting prep docs. You pull the trigger.

The assistant can compose, queue, and present, but a human action is required to actually send/book/commit. This phase gets built when Phase 1 is running reliably and generating real daily value.

## Phase 3 — Act Autonomously

The assistant schedules, sends messages, or takes actions on your behalf. Limited to low-stakes actions initially (confirming appointments, sending pre-approved messages). No financial transactions without explicit per-action approval.

This phase requires write-scoped credentials, stricter audit logging, and reversibility paths. It gets built when Phase 2 has been running reliably and the assistant has demonstrated good judgment.

## How phases progress

New capabilities get added when:
1. The current system has been running reliably long enough to build confidence.
2. The failure modes of the new capability are understood and bounded.
3. There is a clear rollback for anything it might do wrong.

There is no global "graduate the assistant" — capabilities are added individually as trust develops.
