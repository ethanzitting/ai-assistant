# Workflow: Tasks & Projects

Detailed step-by-step traces through task and project use cases. Tests the event engine (`events`, `reminders` tables), the task engine (`tasks`, `projects` tables), the knowledge graph, and context assembly. See [workflow-financial-tracking.md](workflow-financial-tracking.md) for financial workflows.

---

## Walkthrough 1: Recurring Reminder — "Give my dog a tick chew every month"

**User message:** *"Remind me every month to give my dog a tick chew, and if I'm late, bump back the next one so that there's a month in between tick chews."*

This is a textbook `interval_recurring` event — the timer resets from actual completion, not from a calendar anchor. The user is explicitly describing the interval-from-completion model from [event-engine.md](../event-engine.md).

### Step 1 — Telegram message → event queue

grammY receives the message, pushes it as a high-priority event:

```typescript
queue.push({
  type: "user_message",
  priority: "high",
  payload: {
    text: "Remind me every month to give my dog a tick chew, and if I'm late, bump back the next one so that there's a month in between tick chews.",
    chat_id: 12345
  }
});
```

### Step 2 — Context assembly

The core loop picks up the event and assembles the prompt:

- **Layer 1 (stable prefix):** System prompt, tool definitions (including `manage_events` and `remember`), user preferences. Cached.
- **Layer 2 (daily prefix):** Today's calendar, active tasks, pending items. Cached.
- **Layer 3 (recent prefix):** Recent conversation context.
- **Layer 4 (raw conversation):** The new user message.

The LLM sees the `manage_events` tool definition, which describes event types including `interval_recurring`.

### Step 3 — LLM reasons about the request

The LLM parses the user's intent:

- **What:** give dog a tick chew
- **Recurrence:** every month
- **Model:** interval-from-completion (user explicitly said "if I'm late, bump back the next one")
- **Priority:** medium (important for the dog's health, but not a financial or legal deadline)
- **Start:** not specified — the LLM needs to decide whether to ask or assume

The LLM also recognizes an entity extraction opportunity: the user has a dog. If the dog isn't already in the knowledge graph, this is new information worth storing.

### Step 4 — LLM calls tools

**Tool call 1: `remember`**

The LLM checks whether a dog entity already exists. If not, it stores the new information:

```json
{
  "tool": "remember",
  "input": {
    "type": "entity",
    "entity_type": "pet",
    "name": "dog",
    "facts": [
      {"attribute": "species", "value": "dog"},
      {"attribute": "care_item", "value": "monthly tick chew"}
    ]
  }
}
```

The `remember` tool's application code runs entity resolution — does a "dog" entity already exist? If the user has previously mentioned their dog by name ("my dog Max"), the fuzzy matcher would find it. If this is the first mention, a new entity is created.

**Problem surfaced:** the user said "my dog" without a name. The entity gets created with `name = 'dog'`. If the user later says "Max needs his tick chew," the LLM needs to connect "Max" to this unnamed dog entity. This is a common entity resolution challenge — the `remember` tool should handle aliases or the LLM should ask: *"What's your dog's name?"*

**Decision point:** does the LLM ask for the dog's name now, or just proceed? This is a judgment call guided by the system prompt. The system prompt should bias toward getting things done — store what you have, refine later. But the agent should still ask follow-up questions when it genuinely can't proceed without the answer (e.g., filing jointly vs. separately in the tax walkthrough changes the entire task structure). The rule: act on available information, ask only when the answer would change what you do next. The LLM proceeds without asking for the dog's name.

The `remember` tool returns:

```
Created entity: dog (pet). Added facts: species=dog, care_item=monthly tick chew.
```

**Tool call 2: `manage_events`**

```json
{
  "tool": "manage_events",
  "input": {
    "action": "create",
    "event": {
      "title": "Give dog tick chew",
      "type": "interval_recurring",
      "priority": "medium",
      "recurrence_rule": {
        "interval": 1,
        "unit": "month",
        "from_completion": true
      },
      "category": "pet_care",
      "entity_id": "uuid-dog-entity"
    }
  }
}
```

### Step 5 — `manage_events` application code executes

The tool's application code does the following:

**5a. Create the event row:**

```sql
INSERT INTO events (title, type, priority, recurrence_rule, category, status, entity_id)
VALUES (
    'Give dog tick chew',
    'interval_recurring',
    'medium',
    '{"interval": 1, "unit": "month", "from_completion": true}',
    'pet_care',
    'active',
    'uuid-dog-entity'
);
```

**5b. Compute the first reminder time:**

The user didn't say when they last gave a tick chew, or when the next one is due. The application code has a few options:

- **Option A:** set the first reminder for today (assume it's due now)
- **Option B:** set it for one month from today (assume it was just done)
- **Option C:** return to the LLM and say "start date not specified"

The application code picks **Option C** — it returns the created event but flags that no start date was provided. The LLM then asks the user.

The tool returns:

```
Created recurring event: "Give dog tick chew" (monthly, interval-from-completion).
No start date specified — when was the last tick chew given? Or should I set the first reminder for today?
```

### Step 6 — LLM asks the user

The LLM sends a Telegram message:

*"Set up a monthly tick chew reminder for your dog. When did you last give one? I'll set the next reminder for one month after that. Or I can start the reminder from today."*

### Step 7 — User responds

The user replies: *"I gave him one about two weeks ago."*

This arrives as a new high-priority event. The core loop picks it up. The LLM has the previous conversation in Layer 4, so it has full context.

The LLM interprets "about two weeks ago" as approximately May 12 (if today is May 26). It calls `manage_events` again:

```json
{
  "tool": "manage_events",
  "input": {
    "action": "update",
    "event_id": "uuid-tick-chew-event",
    "updates": {
      "last_completed_at": "2026-05-12T00:00:00Z"
    }
  }
}
```

### Step 8 — Application code computes the next reminder

The `manage_events` application code:

1. Sets `last_completed_at = 2026-05-12`
2. Computes next due date: `2026-05-12 + 1 month = 2026-06-12`
3. Creates a reminder:

```sql
INSERT INTO reminders (event_id, remind_at, status)
VALUES ('uuid-tick-chew-event', '2026-06-12T09:00:00Z', 'pending');
```

The `09:00` time comes from the user's preferred reminder time (a preference in the knowledge graph), or a sensible default (morning briefing time).

The tool returns:

```
Updated "Give dog tick chew". Last completed: May 12. Next reminder: June 12.
```

### Step 9 — LLM confirms

*"Done. Next tick chew reminder is June 12. I'll remind you in the morning briefing and send a notification. After you give it, let me know and I'll set the next one for a month later."*

### Step 10 — Conversation persisted, audit logged

The full exchange is written to the `conversations` table. The audit log records:

```sql
INSERT INTO audit_log (action, context, outcome)
VALUES ('create_recurring_event', 
        '{"user_request": "monthly tick chew reminder", "type": "interval_recurring"}',
        '{"event_id": "uuid-...", "next_reminder": "2026-06-12"}');
```

---

### What happens when the reminder fires

**June 12, 9:00 AM.** The event processing loop (every 60 seconds) queries:

```sql
SELECT r.*, e.title, e.priority, e.type, e.entity_id
FROM reminders r
JOIN events e ON r.event_id = e.id
WHERE r.remind_at <= now() AND r.status = 'pending';
```

The tick chew reminder is due. The processing loop pushes it into the event queue as a normal-priority event:

```typescript
queue.push({
  type: "scheduled",
  priority: "normal",
  payload: {
    trigger: "reminder",
    event_id: "uuid-tick-chew-event",
    title: "Give dog tick chew",
    priority: "medium"
  }
});
```

The core loop picks this up. The LLM sees the reminder context and sends a Telegram message:

*"Time to give your dog his tick chew — last one was May 12."*

The reminder is marked as `sent`:

```sql
UPDATE reminders SET status = 'sent' WHERE id = 'uuid-reminder';
```

It also appears in the daily briefing that morning (the `daily_briefing` skill's tool calls would have found it when listing pending reminders).

---

### What happens when you complete it on time

You reply: *"Done, just gave it to him."*

The LLM interprets this as completing the tick chew event. It calls:

```json
{
  "tool": "manage_events",
  "input": {
    "action": "complete",
    "event_id": "uuid-tick-chew-event"
  }
}
```

The application code:

1. Sets `last_completed_at = now()` (June 12)
2. Computes the next due date: `2026-06-12 + 1 month = 2026-07-12`
3. Creates the next reminder:

```sql
INSERT INTO reminders (event_id, remind_at, status)
VALUES ('uuid-tick-chew-event', '2026-07-12T09:00:00Z', 'pending');
```

4. Marks the old reminder as `acknowledged`

The LLM confirms: *"Tick chew logged. Next one due July 12."*

---

### What happens when you're late

**June 12 passes.** You don't respond. The reminder was sent but never acknowledged.

**June 13 — daily briefing.** The `daily_briefing` skill lists overdue items. The `manage_events` tool returns the tick chew as overdue (sent but not acknowledged). The briefing includes:

*"Overdue: dog tick chew (due yesterday)"*

**June 15.** You reply: *"Oh right, just gave him the tick chew."*

The LLM calls `manage_events` with `action: "complete"`. The application code:

1. Sets `last_completed_at = 2026-06-15` (the actual completion date, not the original due date)
2. Computes the next due date: `2026-06-15 + 1 month = 2026-07-15`
3. Creates the next reminder for July 15

**This is the key behavior the user asked for.** The next tick chew is July 15 (one month from when it was actually given), not July 12 (one month from when it was originally due). The `from_completion: true` flag in `recurrence_rule` drives this logic.

If this were a `fixed_recurring` event instead (like trash day), the next occurrence would stay anchored to the 12th of each month regardless of when the user completed it.

---

### What's in the database after this workflow

| Table | Rows | Content |
|---|---|---|
| `events` | 1 | "Give dog tick chew", type=interval_recurring, last_completed_at=June 15 |
| `reminders` | 3 | May→June (acknowledged), June (acknowledged late), July (pending) |
| `entities` | 1 | Dog entity (type=pet) |
| `facts` | 2 | species=dog, care_item=monthly tick chew |
| `relationships` | 1 | User → owns → dog |
| `audit_log` | 2+ | Event creation, each completion |
| `conversations` | ~10 | Full conversation thread |

### Schema observations

The event engine schema handles this case well. The `interval_recurring` type with `from_completion: true` in `recurrence_rule` is exactly the right model. The `last_completed_at` column tracks when the timer resets.

The `events` table should include a `next_due_at` column that caches the next due date. This is updated by application code whenever an event is completed or a recurrence is computed. It makes "what's due this week" a simple `WHERE next_due_at <= $end_of_week` query instead of computing the next occurrence for every active recurring event at query time. The [version-one.md](version-one.md) schema should be updated to include this column.

**Another gap:** there's no link between the event and the `reminders` table that captures "user was reminded but hasn't acted." The `sent` status on the reminder captures this, but the escalation behavior (daily briefing mentions, priority bumps) isn't explicitly modeled — it's driven by the LLM's judgment when it sees an overdue sent-but-unacknowledged reminder. This is probably fine; encoding escalation rules in the schema would over-complicate things when the LLM can handle it.

---

## Walkthrough 2: Complex Project — "Help me file my taxes"

**User message:** *"Help me file my taxes this year. I live in Northwest Arkansas. I have two cars, a house, a W-2 job, and some side gig work. I'm married with two kids, no health insurance."*

This is a fundamentally different kind of interaction from the tick chew. It's a multi-step project with:

- A hard deadline (April 15, 2027 for tax year 2026)
- Many subtasks, some with dependencies
- A burst of knowledge graph facts in a single message
- Research needs (Arkansas state taxes, side gig deductions, no-insurance implications)
- Clarifying questions the assistant needs to ask
- Cross-domain connections (financial data, calendar, documents)

This tests the project engine, the knowledge graph, the event engine, and the assistant's ability to decompose a vague request into actionable steps.

### Step 1 — Telegram message → event queue

Same as before. High-priority user message enters the queue.

### Step 2 — Context assembly

The prompt is assembled. Notably, if the user has financial data in the system (transaction history from [workflow-financial-tracking.md](workflow-financial-tracking.md)), some of that context may appear in Layer 2 (daily prefix) or be retrieved via tools.

### Step 3 — LLM reasons about the request

The LLM has a lot to process in this single message. It needs to:

1. **Extract facts** — the user just volunteered a dense set of personal information
2. **Create a project** with initial task decomposition
3. **Set up deadlines** — the tax filing deadline
4. **Identify what it doesn't know** — it needs to ask clarifying questions
5. **Potentially trigger research** — Arkansas-specific tax requirements

The LLM's internal reasoning (not visible to user):

> The user wants help filing taxes. This is a project, not a single task. I need to:
> - Store the facts they just gave me (location, vehicles, property, employment, family, insurance)
> - Create a project with tasks broken into phases: gather documents, choose filing method, prepare return, file
> - Set the April 15 deadline
> - Ask clarifying questions: filing jointly? Side gig revenue ballpark? Tax software preference?
> - Some of this info might already be in the knowledge graph — check before creating duplicates

### Step 4 — LLM calls tools (first batch)

The LLM makes multiple tool calls. These happen sequentially (each one returns results the LLM reasons about before the next).

**Tool call 1: `query_knowledge`**

Before storing new facts, the LLM checks what it already knows about the user's tax-relevant situation:

```json
{
  "tool": "query_knowledge",
  "input": {
    "question": "user's location, employment, marital status, dependents, property, vehicles"
  }
}
```

The application code queries entities, facts, and relationships. Let's say it returns:

```
Known facts about user:
- Location: Northwest Arkansas (fact, current)
- Employer: Acres Capital (fact, current)
- Spouse: Sarah Zitting (relationship: married_to, entity exists)
- Children: 2 (facts on child entities)
- Property: [no property entities found]
- Vehicles: [no vehicle entities found]
- Insurance: [no health insurance facts found]
```

Some facts already exist (location, employer, family). Others are new (property, vehicles, insurance status).

**Tool call 2: `remember`**

The LLM stores the new facts, skipping what already exists:

```json
{
  "tool": "remember",
  "input": {
    "extractions": [
      {
        "type": "entity",
        "entity_type": "property",
        "name": "house",
        "facts": [{"attribute": "type", "value": "primary_residence"}, {"attribute": "location", "value": "Northwest Arkansas"}]
      },
      {
        "type": "entity",
        "entity_type": "vehicle",
        "name": "car_1",
        "facts": [{"attribute": "type", "value": "car"}]
      },
      {
        "type": "entity",
        "entity_type": "vehicle",
        "name": "car_2",
        "facts": [{"attribute": "type", "value": "car"}]
      },
      {
        "type": "fact",
        "entity_hint": "user",
        "attribute": "employment_type",
        "value": "W-2 plus side gig"
      },
      {
        "type": "fact",
        "entity_hint": "user",
        "attribute": "health_insurance",
        "value": "none"
      }
    ]
  }
}
```

The `remember` tool's application code:

1. Creates the house entity, links it to the user via `owns` relationship
2. Creates two car entities (unnamed for now), links them to the user
3. Adds the employment and insurance facts to the user entity

**Problem surfaced:** the cars have no detail — no make, model, or year. The house has no address. The LLM could ask, or it could store what it has and refine later. For tax purposes, vehicle details matter if the user deducts mileage. The house matters for property tax deductions and mortgage interest. The LLM should ask, but later — not in a barrage of questions right now.

**Tool call 3: `manage_tasks`**

The LLM creates the project and initial tasks:

```json
{
  "tool": "manage_tasks",
  "input": {
    "action": "create",
    "project": {
      "title": "File 2026 taxes",
      "description": "Federal and Arkansas state tax return. W-2 income, side gig (1099), two cars, house, married filing jointly (TBD), two dependents, no health insurance."
    },
    "tasks": [
      {
        "title": "Determine filing status",
        "description": "Confirm married filing jointly vs separately. Determine if side gig is sole proprietor or LLC.",
        "priority": "high",
        "surfacing_policy": "daily"
      },
      {
        "title": "Gather W-2 from employer",
        "description": "W-2 from Acres Capital. Usually available by end of January.",
        "priority": "high",
        "surfacing_policy": "daily"
      },
      {
        "title": "Gather side gig income records",
        "description": "1099s, invoices, or bank records for all side gig income. Track deductible business expenses.",
        "priority": "high",
        "surfacing_policy": "daily"
      },
      {
        "title": "Gather property tax records",
        "description": "Property tax paid on house in 2026. Needed for itemized deductions.",
        "priority": "medium",
        "surfacing_policy": "daily"
      },
      {
        "title": "Gather mortgage interest statement",
        "description": "1098 from mortgage lender, if applicable.",
        "priority": "medium",
        "surfacing_policy": "daily"
      },
      {
        "title": "Research no-insurance implications",
        "description": "Check if there's still a federal or Arkansas penalty for no health insurance in 2026.",
        "priority": "medium",
        "surfacing_policy": "weekly"
      },
      {
        "title": "Choose filing method",
        "description": "TurboTax, CPA, FreeTaxUSA, etc. Side gig income may complicate DIY filing.",
        "priority": "medium",
        "surfacing_policy": "weekly"
      },
      {
        "title": "Prepare and file federal return",
        "description": "After all documents gathered and filing method chosen.",
        "priority": "high",
        "surfacing_policy": "daily",
        "status": "waiting"
      },
      {
        "title": "Prepare and file Arkansas state return",
        "description": "After federal return completed.",
        "priority": "high",
        "surfacing_policy": "daily",
        "status": "waiting"
      }
    ]
  }
}
```

The `manage_tasks` application code creates one `projects` row and nine `tasks` rows:

```sql
INSERT INTO projects (title, description, status)
VALUES ('File 2026 taxes', 'Federal and Arkansas state...', 'active')
RETURNING id;

-- For each task:
INSERT INTO tasks (title, description, status, priority, project_id, surfacing_policy)
VALUES ('Gather W-2 from employer', '...', 'open', 'high', 'uuid-tax-project', 'daily');
```

**Tool call 4: `manage_events`**

The LLM sets up the tax deadline:

```json
{
  "tool": "manage_events",
  "input": {
    "action": "create",
    "event": {
      "title": "Federal tax filing deadline",
      "type": "deadline",
      "priority": "high",
      "deadline": "2027-04-15T23:59:00Z",
      "lead_time_days": 60,
      "category": "taxes"
    }
  }
}
```

The application code creates the event and computes reminders based on the 60-day lead time:

```sql
INSERT INTO events (title, type, priority, deadline, lead_time_days, category, status)
VALUES ('Federal tax filing deadline', 'deadline', 'high',
        '2027-04-15T23:59:00Z', 60, 'taxes', 'active');

-- Lead-time reminder: start acting 60 days before = ~Feb 14
INSERT INTO reminders (event_id, remind_at, status)
VALUES ('uuid-tax-deadline', '2027-02-14T09:00:00Z', 'pending');

-- Additional reminders at standard intervals for high-priority deadlines
INSERT INTO reminders (event_id, remind_at, status)
VALUES ('uuid-tax-deadline', '2027-03-15T09:00:00Z', 'pending');  -- 1 month before

INSERT INTO reminders (event_id, remind_at, status)
VALUES ('uuid-tax-deadline', '2027-04-01T09:00:00Z', 'pending');  -- 2 weeks before

INSERT INTO reminders (event_id, remind_at, status)
VALUES ('uuid-tax-deadline', '2027-04-10T09:00:00Z', 'pending');  -- 5 days before
```

### Step 5 — LLM responds with clarifying questions

After all tool calls complete, the LLM has created the project, tasks, and deadline. Now it responds to the user with a summary and targeted questions — not a wall of interrogation, just the most important unknowns:

*"I've set up a tax filing project with 9 tasks. The federal deadline is April 15, 2027 — I'll start reminding you in mid-February.*

*A few things I need to know to keep this on track:*

*1. Will you and Sarah file jointly or separately? (Joint is usually better unless there's a specific reason not to.)*
*2. Is your side gig income on a 1099, or cash/informal? Rough ballpark — under $5K, $5-20K, or more?*
*3. Do you have a mortgage on the house?*

*I'll research the no-insurance question and Arkansas-specific requirements on my own."*

### Step 6 — User responds

*"Filing jointly. Side gig is 1099 work, around $15K. Yeah we have a mortgage."*

New high-priority event. The LLM has the full conversation in Layer 4.

**Tool call: `remember`**

```json
{
  "tool": "remember",
  "input": {
    "extractions": [
      {"type": "fact", "entity_hint": "user", "attribute": "tax_filing_status_2026", "value": "married filing jointly"},
      {"type": "fact", "entity_hint": "user", "attribute": "side_gig_income_2026", "value": "~$15,000, 1099"},
      {"type": "fact", "entity_hint": "house", "attribute": "has_mortgage", "value": "yes"}
    ]
  }
}
```

The LLM also updates the task for the mortgage interest statement — it was "if applicable," now it's confirmed:

```json
{
  "tool": "manage_tasks",
  "input": {
    "action": "update",
    "task_title": "Gather mortgage interest statement",
    "updates": {
      "description": "1098 from mortgage lender. Confirmed: house has a mortgage.",
      "priority": "high"
    }
  }
}
```

And the LLM might add new tasks based on the 1099 answer:

```json
{
  "tool": "manage_tasks",
  "input": {
    "action": "create",
    "tasks": [
      {
        "title": "Track side gig business expenses",
        "description": "Deductible expenses against 1099 income: equipment, software, home office, mileage. Gather receipts and records for 2026.",
        "project_id": "uuid-tax-project",
        "priority": "high",
        "surfacing_policy": "daily"
      },
      {
        "title": "Estimate quarterly tax payments",
        "description": "With $15K in 1099 income, may owe quarterly estimated taxes. Check if Q4 2026 payment is still needed.",
        "project_id": "uuid-tax-project",
        "priority": "high",
        "surfacing_policy": "daily"
      }
    ]
  }
}
```

The LLM responds:

*"Got it — joint filing, $15K in 1099 income, mortgage confirmed. I've added tasks for tracking your side gig expenses and checking on quarterly estimated tax payments (with $15K in 1099 income, you may owe estimated taxes).*

*Your current task list for this project:*

*1. ~~Determine filing status~~ — married filing jointly*
*2. Gather W-2 from Acres Capital*
*3. Gather 1099 / side gig records (~$15K)*
*4. Track side gig business expenses*
*5. Estimate quarterly tax payments*
*6. Gather property tax records*
*7. Gather mortgage interest statement (1098)*
*8. Research no-insurance implications*
*9. Choose filing method*
*10. Prepare & file federal return (waiting on documents)*
*11. Prepare & file Arkansas return (waiting on federal)*

*I'll surface the document-gathering tasks in your daily briefings starting in January. Want me to research the insurance question now?"*

### Step 7 — Research triggered (Version 2+)

If the user says "yes," the LLM instructs the ingestion container to research Arkansas health insurance penalty status for 2026 via web search (see [ingestion.md](../ingestion.md) for the web search flow). The results come back through the emission pipeline, and the LLM summarizes them in a follow-up message.

In Version 1 (no web search), the LLM would provide what it knows from training data and note that the user should verify.

### Step 8 — How this project lives over time

**Daily briefings (January–April 2027):**

The `daily_briefing` skill calls `manage_tasks` to list tasks with `surfacing_policy = 'daily'` under the tax project. As deadlines approach:

```
Tax filing (due April 15):
- ⬜ Gather W-2 from Acres Capital — should arrive by Jan 31
- ⬜ Gather 1099s for side gig income
- ⬜ Gather property tax records
- ⬜ Gather 1098 mortgage interest statement
- ⬜ Track side gig expenses
```

**When a W-2 email arrives:**

If email ingestion (V2) is running, a W-2 notification email from the employer is classified as `transactional`, and the extraction pipeline recognizes it as tax-relevant. The ingestion LLM emits a fact: `"W-2 available from Acres Capital"`. Core processes the emission, links it to the tax project, and potentially updates the task status. The daily briefing reflects the change:

```
- ✅ Gather W-2 from Acres Capital — received Jan 28
```

**When the lead-time reminder fires (February 14):**

The event engine fires the 60-day reminder. The LLM sends a Telegram message:

*"Tax deadline is 60 days out (April 15). Your tax project has 4 open document-gathering tasks and 2 waiting tasks. Want a status review?"*

**When you upload a document:**

If you send a photo of your property tax bill to the bot, it flows through the receipt/document OCR pipeline (same as [workflow-financial-tracking.md](workflow-financial-tracking.md)). The ingestion LLM extracts the property tax amount, emits it as a fact. Core could auto-complete the "Gather property tax records" task if it recognizes the document type.

### What's in the database after this workflow

| Table | Rows | Content |
|---|---|---|
| `projects` | 1 | "File 2026 taxes" |
| `tasks` | 11 | All tasks under the project, various statuses |
| `events` | 1 | Tax deadline with lead_time_days=60 |
| `reminders` | 4 | Feb 14, Mar 15, Apr 1, Apr 10 reminders |
| `entities` | 3+ | House, car_1, car_2 (dog from walkthrough 1) |
| `facts` | 8+ | Location, employment type, filing status, side gig income, insurance status, mortgage, etc. |
| `relationships` | 3+ | User→owns→house, user→owns→car_1, user→owns→car_2 |
| `audit_log` | 3+ | Project creation, fact storage, task updates |
| `conversations` | ~15 | Full conversation thread |

---

### Schema Observations

#### The event engine and task engine work together but stay separate

The tick chew is an **event** — it's purely about timing and recurrence. The tax project uses both **tasks** (what needs to be done) and **events** (the deadline). This separation is clean: events handle *when*, tasks handle *what*.

But there's a subtle interaction: the tax deadline event should be aware of the tax project's task completion status. If all tasks are done by March 1, the April 15 deadline reminders are less urgent. If it's April 10 and 5 tasks are still open, the reminders should escalate. Currently, there's no FK between `events` and `projects`. The LLM bridges this gap during briefing assembly by querying both and reasoning about the relationship — but it requires the LLM to make that connection every time.

**Decision (2026-05-26):** Added an optional `project_id UUID REFERENCES projects(id)` to the `events` table. This lets the briefing skill directly join deadline events with their associated project's task completion status, rather than relying on the LLM to correlate by title and entity every time.

#### Task dependencies aren't modeled

The tax workflow has implicit dependencies: can't file federal return until documents are gathered, can't file state return until federal is done. The current `tasks` table has no `depends_on` column or dependency tracking.

The workaround is `status = 'waiting'` — the "prepare and file" tasks start as waiting, and the LLM manually transitions them to `open` when prerequisites are done. This is adequate for a personal assistant where the user is the one doing the work. Formal dependency tracking (blocking, critical path) adds complexity without proportional value at this scale.

#### The knowledge graph absorbs a lot of incidental facts

A single message produced 5+ facts (location, employment type, side gig income, filing status, insurance status) plus 3 new entities (house, two cars). This is the knowledge graph working as designed — every interaction is a chance to learn. But it also means the knowledge graph grows quickly, and the daily prefix (Layer 2) needs to be selective about which facts to include. "User has no health insurance" is relevant during tax season, irrelevant in August.

The daily prefix should be context-aware about which facts to surface — not every fact about the user, but facts relevant to active projects and upcoming events. This is a prompt engineering challenge, not a schema one.

#### Unnamed entities are a recurring problem

Both walkthroughs produced unnamed entities: "dog" without a name, "car_1" and "car_2" without make/model. The entity resolution system needs to handle subsequent references gracefully:

- *"Take Max to the vet"* → is Max the dog? If the dog entity exists but is named "dog", the LLM needs to connect these and update the entity name.
- *"The Subaru needs an oil change"* → which car is the Subaru? The LLM should update one of the car entities with this detail.

This isn't a schema problem — the schema supports renaming entities and adding facts. It's an LLM prompt engineering challenge: the system prompt should instruct the LLM to watch for opportunities to enrich sparse entities.
