# Workflow: Outbound Text Messaging (SMS)

Give the assistant the ability to send SMS messages to your phone and to contacts in the knowledge graph. This is a Trust Phase 3 capability (Act Autonomously) — the assistant sends real messages to real people — so the implementation is staged to build trust incrementally.

## Context

The assistant currently sends all outbound messages through Telegram via the `send_message` tool. That tool is hardcoded to a single channel (Telegram) and a single recipient (you). SMS adds a second output channel and, eventually, the ability to reach other people.

SMS is useful for two reasons:
1. **Reaching you when Telegram isn't ideal.** Time-sensitive reminders or alerts when you're not checking Telegram.
2. **Reaching other people on your behalf.** "Text Sarah that I'm running 10 minutes late." This is where the real value lives — and where the real risk is.

## Provider

Twilio. Mature REST API, no SDK needed (just a POST with Basic auth), good delivery reliability, reasonable cost. The API works with a simple `fetch` call from Deno — no npm dependency required.

Cost: ~$1.15/month for a phone number + ~$0.0079 per outbound SMS segment. At personal-assistant volumes (a few texts per day), this is under $5/month total.

Alternatives considered:
- **Vonage/Plivo** — slightly cheaper per-segment but smaller ecosystem, not worth the tradeoff at this scale.
- **iMessage via AppleScript** — would require a Mac server, fragile, and only reaches other iPhone users.

## Secrets

Three new 1Password entries in the `ai.assistant` vault:

| Secret | 1Password reference |
|---|---|
| Account SID | `op://ai.assistant/TWILIO_ACCOUNT_SID/notesPlain` |
| Auth Token | `op://ai.assistant/TWILIO_AUTH_TOKEN/notesPlain` |
| Phone Number | `op://ai.assistant/TWILIO_PHONE_NUMBER/notesPlain` |

Added to `.env.tpl` alongside existing secrets. The Twilio phone number is the `From` number on all outbound SMS.

## Implementation

### Phase 1 — SMS to yourself only

Extend the existing `send_message` tool to support a `channel` parameter. The tool resolves the recipient and dispatches to the appropriate transport.

**Tool schema change:**

```typescript
{
  name: "send_message",
  description: "Send a message to the user. Defaults to Telegram. Use SMS for time-sensitive alerts when the user may not be checking Telegram.",
  input_schema: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The message text to send",
      },
      channel: {
        type: "string",
        enum: ["telegram", "sms"],
        description: "Delivery channel. Defaults to telegram.",
      },
    },
    required: ["text"],
  },
}
```

When `channel` is `"sms"`, the tool sends via Twilio to the owner's phone number (stored in the `preferences` table as `owner_phone_number`, seeded during setup). No recipient parameter — Phase 1 only messages you.

**New files:**
- `src/sms/sendSms.ts` — thin wrapper around the Twilio REST API. Accepts `to`, `body`, returns the Twilio message SID. No SDK, just `fetch`.

**Modified files:**
- `src/telegram/messagingTool.ts` — rename to `src/messaging/messagingTool.ts`. Add `channel` handling: default to `"telegram"`, dispatch to `sendSms()` or `sendTelegramMessage()`.
- `.env.tpl` — add the three Twilio secret references.

**Migration:**
- `migrations/008_owner_phone.sql` — seed `owner_phone_number` in the `preferences` table (or add via the `remember` tool during setup).

**Testable at end of phase:**
- "Send me a text that says hello" → SMS arrives on your phone
- "Remind me to take the dog out" (with SMS delivery preference) → SMS at reminder time
- Default behavior unchanged — messages without `channel: "sms"` still go to Telegram

### Phase 2 — SMS to contacts (with confirmation)

Add a `recipient` parameter that resolves to a phone number via the knowledge graph. Before sending, the assistant confirms with you via Telegram.

**Tool schema change:**

```typescript
{
  name: "send_message",
  input_schema: {
    type: "object",
    properties: {
      text: { type: "string", description: "The message text to send" },
      channel: {
        type: "string",
        enum: ["telegram", "sms"],
        description: "Delivery channel. Defaults to telegram.",
      },
      recipient: {
        type: "string",
        description: "Name of a person in the knowledge graph. Required for SMS to contacts. Omit to message the owner.",
      },
    },
    required: ["text"],
  },
}
```

**Resolution flow:**

1. Claude calls `send_message` with `recipient: "Sarah"` and `channel: "sms"`.
2. The tool queries the knowledge graph for an entity matching "Sarah" and retrieves the `phone` fact.
3. If no match or no phone number → return an error ("No phone number found for Sarah").
4. If ambiguous (multiple Sarahs) → return candidates, let Claude ask you to clarify.
5. If resolved → **do not send yet**. Queue a pending message and ask for confirmation via Telegram: "I'd like to text Sarah (555-123-4567): 'Running 10 minutes late.' Send it?"
6. You reply "yes" → send. You reply "no" or ignore → drop.

**New tables:**

```sql
CREATE TABLE pending_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel TEXT NOT NULL,
    recipient_entity_id UUID REFERENCES entities(id),
    recipient_address TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'approved', 'rejected', 'expired', 'sent', 'failed'
    requested_at TIMESTAMPTZ DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    twilio_sid TEXT
);
```

**Confirmation UX:**

The Telegram confirmation message includes an inline keyboard (grammY supports this) with "Send" and "Cancel" buttons. If no response within 15 minutes, the message expires. This avoids the assistant sitting in a blocking state — it queues the message, confirms, and moves on.

**New files:**
- `src/messaging/pendingMessages.ts` — queue, confirm, reject, expire pending messages.
- `src/messaging/resolveRecipient.ts` — entity name → phone number resolution via knowledge graph.

**Modified files:**
- `src/messaging/messagingTool.ts` — add recipient handling, confirmation flow.
- `src/telegram/createTelegramBot.ts` — add callback query handler for inline keyboard responses.

**Migration:**
- `migrations/009_pending_messages.sql` — create the `pending_messages` table.

**Testable at end of phase:**
- "Text Sarah that I'm running late" → Telegram confirmation appears with inline buttons → tap Send → SMS delivered
- "Text Sarah" when no phone number exists → "No phone number found for Sarah"
- "Text Sarah" when multiple Sarahs exist → "Which Sarah? Sarah Chen or Sarah Miller?"
- Pending message expires after 15 minutes with no response
- `pending_messages` table tracks every attempt with status and timestamps

### Phase 3 — Autonomous sending for trusted patterns

Remove the confirmation requirement for specific, pre-approved patterns. This is the Trust Phase 3 capability — the assistant sends without asking. Only enabled after Phase 2 has been running reliably and you've built confidence in the resolution and content quality.

**Trusted patterns (stored in `preferences`):**

- Messages to specific contacts (e.g., spouse) below a character limit
- Time-sensitive reminders to yourself
- Confirmation-style messages ("On my way", "Running late", "See you at 7")

Any message that doesn't match a trusted pattern still goes through the Phase 2 confirmation flow. The assistant never graduates to fully autonomous sending for arbitrary content — the confirmation flow is the permanent default, with trusted patterns as explicit exceptions.

**No new infrastructure** — this is a policy layer on top of Phase 2. The `pending_messages` table still logs every send (approved messages just skip the confirmation step and go directly to `status = 'approved'`).

## Message tracking

All outbound SMS (across all phases) is logged in the `audit_log` table with:
- Action: `sms_sent`
- Context: recipient entity ID, phone number, message body, Twilio SID
- Outcome: `delivered`, `failed`, `expired`, `rejected`

Twilio delivery status webhooks are deferred — polling the Twilio API for delivery status is simpler and avoids exposing a public endpoint. The webhook approach is better at scale but not worth the infrastructure for personal use.

## Regulatory notes

For personal use (sending texts to people you know, from your own Twilio number), TCPA and 10DLC registration do not apply. If this ever scales to business use or bulk messaging, A2P 10DLC registration would be required (~$15 one-time + carrier fees). Not relevant now.

## Cost summary

| Item | Cost |
|---|---|
| Twilio phone number | ~$1.15/month |
| Outbound SMS (est. 5-10/day) | ~$1.50/month |
| **Total** | **~$3/month** |

## Effort summary

| Phase | Scope | Effort |
|---|---|---|
| Phase 1 — SMS to self | Twilio client, extend `send_message`, secrets | ~2 hours |
| Phase 2 — SMS to contacts | Recipient resolution, confirmation flow, pending messages table | ~4 hours |
| Phase 3 — Autonomous patterns | Policy layer on Phase 2 | ~2 hours |
| **Total** | | **~8 hours** |

## Dependencies

- **Knowledge graph seeding (V1 Phase 4)** — contacts must have phone numbers stored as facts for Phase 2 recipient resolution to work. Phase 1 (SMS to self) has no dependency on this.
- **Event engine (V1 Phase 5)** — for SMS-delivered reminders. Already complete.

## Open questions

1. **Should SMS be a separate tool or part of `send_message`?** This plan extends `send_message` because channel selection is a routing decision, not a different capability. A separate `send_sms` tool is simpler but fragments the messaging surface — Claude would need to reason about which tool to use rather than which channel.
2. **MMS support?** Twilio supports MMS (images, files) at ~$0.02/segment. Useful for sending photos or screenshots. Not in scope for the initial implementation but the Twilio client could support it later with a `media_url` parameter.
3. **Inbound SMS?** Twilio can forward incoming SMS to a webhook. This would let people text your Twilio number and have it routed to the assistant. Requires a public endpoint (or Twilio function as proxy). Deferred — inbound communication comes through Telegram for now.
