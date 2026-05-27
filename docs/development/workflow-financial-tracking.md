# Example Workflows

Detailed step-by-step traces through realistic use cases. Each trace follows data from entry point to final user interaction, touching every component in the architecture. The purpose is to stress-test the schema and identify gaps before building.

---

## Financial Tracking

Financial awareness spans multiple subsystems: ingestion (getting transaction data in), the knowledge graph (storing accounts, merchants, patterns), the event engine (bill due dates), and context assembly (surfacing the right financial context at the right time).

The current schema (entities, facts, relationships, events) was designed for things like "Sarah works at Stripe" — not for 500 monthly credit card transactions. This walkthrough will surface where the schema works, where it needs extension, and what the actual data flow looks like.

### Data sources

Financial data enters the system through four paths, roughly in order of implementation priority:

1. **CSV transaction export** — download from bank website, upload via Telegram or Google Drive
2. **Receipt photos** — snap a photo, send to Telegram bot, OCR extracts line items
3. **Email notifications** — bank alerts, bill reminders, payment confirmations processed through the email pipeline
4. **Plaid API** — automated transaction sync and balance checking (Version 3, read-only)

Each path enters through a different ingestion channel but produces the same output: structured transaction records in the database and entity/fact updates in the knowledge graph.

---

### Walkthrough 1: CSV Transaction Import

**Scenario:** You download your May credit card statement as a CSV from your bank's website and send it to the Telegram bot.

#### Step 1 — File arrives via Telegram

You send the CSV file to the Telegram bot. grammY (running in the agent container) receives the message:

```
message.document: {
  file_name: "chase-sapphire-may-2026.csv",
  mime_type: "text/csv",
  file_id: "BQACAgIAAxk..."
}
```

The agent's Telegram handler recognizes this as a file attachment, not a text message. Per the event loop in `agent/src/engine/`, file attachments are forwarded to the ingestion container for processing.

#### Step 2 — The agent downloads and stages the file

The agent calls the Telegram Bot API to download the file using the `file_id`. It writes the raw CSV to a shared volume mount that ingestion can read:

```
/shared/incoming/2026-05-26T14:32:00Z_telegram_chase-sapphire-may-2026.csv
```

The agent then inserts a processing request into the coordination table so ingestion knows there's work to do:

```sql
INSERT INTO processing_requests (type, source_type, file_path, status, metadata)
VALUES ('file_parse', 'telegram_file',
        '/shared/incoming/2026-05-26T14:32:00Z_telegram_chase-sapphire-may-2026.csv',
        'pending',
        '{"original_filename": "chase-sapphire-may-2026.csv", "mime_type": "text/csv", "chat_id": 12345}');
```

The agent sends an immediate Telegram reply: *"Got it — processing your CSV now."*

#### Step 3 — Ingestion picks up the file

Ingestion polls `processing_requests` for rows with `status = 'pending'` (every 5-10 seconds). It claims the request by setting `status = 'processing'`.

Ingestion reads the CSV from the shared volume. This is structured data, so no LLM call is needed for parsing — standard CSV parsing handles it. A typical bank CSV looks like:

```csv
Transaction Date,Post Date,Description,Category,Type,Amount
05/01/2026,05/02/2026,TRADER JOES #123,Groceries,Sale,-87.43
05/01/2026,05/02/2026,KOMBUCHA TOWN,Food & Drink,Sale,-12.99
05/03/2026,05/04/2026,SHELL OIL 57442,Gas,Sale,-48.20
05/05/2026,05/06/2026,AMAZON.COM*AB1CD2EF,Shopping,Sale,-34.99
05/07/2026,05/07/2026,PAYMENT THANK YOU,,Payment,2847.00
```

#### Step 4 — Ingestion normalizes and classifies

For each row, ingestion:

1. **Parses the amount.** Negative = expense, positive = payment/credit.
2. **Normalizes the merchant name.** `TRADER JOES #123` → `Trader Joe's`. `SHELL OIL 57442` → `Shell`. `AMAZON.COM*AB1CD2EF` → `Amazon`. This is a mix of rule-based cleanup (strip store numbers, uppercase normalization) and a lightweight LLM call for ambiguous cases.
3. **Maps categories.** Use the bank's category if present, otherwise the LLM assigns one from a fixed category list.
4. **Detects the account.** The filename or a header row identifies this as the Chase Sapphire card. If ambiguous, ingestion emits a clarification request.

#### Step 5 — Ingestion runs the injection classifier

Even though this is a CSV (low injection risk), the injection classifier scores the content. A CSV full of transaction descriptions is benign — score will be near 0.0. This step exists because the same pipeline handles all file types, and a malicious file disguised as a CSV could contain injection attempts in the description fields.

#### Step 6 — Ingestion emits structured records

For each transaction, ingestion inserts a row into `ingestion_emissions`:

```sql
INSERT INTO ingestion_emissions (type, status, payload, source_type, source_ref, risk_score)
VALUES ('transaction', 'pending', '{
    "date": "2026-05-01",
    "merchant_raw": "TRADER JOES #123",
    "merchant_normalized": "Trader Joe''s",
    "category": "groceries",
    "amount": -87.43,
    "description": "TRADER JOES #123",
    "account_hint": "Chase Sapphire"
}', 'telegram_file', '/archive/2026/05/transactions/chase-sapphire-may-2026.csv', 0.02);
```

Ingestion also emits entity records for any merchants it hasn't seen before:

```sql
INSERT INTO ingestion_emissions (type, status, payload, source_type, source_ref, risk_score)
VALUES ('entity', 'pending', '{
    "type": "merchant",
    "name": "Kombucha Town",
    "properties": {"category": "food_and_drink", "first_seen": "2026-05-01"}
}', 'telegram_file', '/archive/2026/05/transactions/chase-sapphire-may-2026.csv', 0.01);
```

A typical monthly statement produces ~50-150 transaction emissions and ~5-20 new merchant entity emissions.

#### Step 7 — Ingestion archives the raw file

Before finishing, ingestion uploads the original CSV to B2:

```
files/2026/05/transactions/chase-sapphire-may-2026.csv
```

The file is now permanently archived regardless of what happens next.

#### Step 8 — The agent polls and validates emissions

The agent's emission polling loop (every 5-10 seconds) picks up the new `pending` emissions. For each one:

**Transaction emissions:**

1. Validate the payload against the transaction emission schema (required fields: date, amount, merchant_normalized, category, account_hint).
2. Resolve the account: look up an entity with `type = 'financial_account'` and a matching name/alias. If `Chase Sapphire` isn't in the knowledge graph yet, create it (or ask the user if ambiguous).
3. Resolve the merchant: run entity resolution against existing merchant entities. `Trader Joe's` probably already exists. `Kombucha Town` might be new.
4. Write the validated transaction to the `transactions` table (see schema implications below).
5. Mark the emission as `processed`.

**Entity emissions (new merchants):**

1. Run fuzzy name matching against existing entities. Is `Kombucha Town` already in the knowledge graph as `Kombucha Town Brewing` or `KBT`?
2. If no match, create the new entity.
3. If ambiguous match, set emission to `awaiting_clarification` and ask the user.

#### Step 9 — The agent writes to the transactions table

Each validated transaction becomes a row:

```sql
INSERT INTO transactions (account_id, date, amount, merchant_id, merchant_raw, category, description, source, source_ref)
VALUES (
    'uuid-chase-sapphire',  -- resolved account entity
    '2026-05-01',
    -87.43,
    'uuid-trader-joes',     -- resolved merchant entity
    'TRADER JOES #123',
    'groceries',
    'TRADER JOES #123',
    'csv_import',
    '/archive/2026/05/transactions/chase-sapphire-may-2026.csv'
);
```

#### Step 10 — The agent updates knowledge graph facts

After processing all transactions, the agent updates derived facts:

```sql
-- Update the account's "last_statement_date" fact
INSERT INTO facts (entity_id, attribute, value, valid_from, source_ref)
VALUES ('uuid-chase-sapphire', 'last_statement_date', '2026-05-26',
        now(), '/archive/2026/05/transactions/chase-sapphire-may-2026.csv');

-- Supersede the old "last_statement_date" fact
UPDATE facts SET valid_until = now()
WHERE entity_id = 'uuid-chase-sapphire'
  AND attribute = 'last_statement_date'
  AND valid_until IS NULL
  AND id != (the new fact id);
```

The agent might also compute and store aggregate facts like monthly spending by category — or defer that to query time. The tradeoff: precomputing makes queries fast but means more stored facts that can go stale; computing at query time is always fresh but costs a SQL query.

#### Step 11 — The agent confirms to user

The agent sends a Telegram message summarizing the import:

*"Processed 87 transactions from Chase Sapphire (May 2026). Total spending: $3,241.18. Largest categories: Groceries ($412), Restaurants ($287), Gas ($198). 3 new merchants added. Ready to answer questions about your May spending."*

#### What's in the database after this workflow

| Table | New rows | Content |
|---|---|---|
| `transactions` | ~87 | Every transaction with resolved account and merchant IDs |
| `entities` | ~5-20 | New merchant entities (Kombucha Town, etc.) |
| `entities` | 0-1 | Chase Sapphire account entity (if new) |
| `facts` | 1+ | Account metadata updates |
| `relationships` | ~5-20 | New `transacts_at` relationships between user entity and new merchants |
| `audit_log` | 1 | Record of the CSV import with transaction count and totals |
| B2 archive | 1 file | Raw CSV |
| `ingestion_emissions` | ~100+ | All emissions marked `processed` |

---

### Walkthrough 2: Receipt Photo via Telegram

**Scenario:** You buy lunch and want to track it. You snap a photo of the receipt and send it to the Telegram bot.

#### Step 1 — Photo arrives via Telegram

grammY receives a `message.photo` event. Telegram provides multiple photo resolutions; the agent downloads the largest one.

#### Step 2 — The agent stages the file

Same as CSV: write to shared volume, insert a `processing_request` with `type = 'receipt_ocr'`. Send an immediate Telegram reply: *"Got the receipt — processing it now."*

#### Step 3 — Ingestion runs OCR

Ingestion picks up the request and runs OCR on the image. Options:

- **Tesseract** (free, runs locally, good for clean receipts)
- **Cloud OCR API** (Google Vision, AWS Textract — better accuracy on crumpled/faded receipts, costs ~$0.001-0.01/image)

OCR output is raw text, often messy:

```
BLUE PLATE CAFE
123 Main St, Salt Lake City
05/26/2026  12:47 PM

Grilled Chicken Sand  14.99
Side Salad             5.99
Sparkling Water        3.50
Kombucha               6.99

Subtotal              31.47
Tax                    2.20
Total                 33.67

Visa ****4821
```

#### Step 4 — Injection classifier scores the OCR text

Score: ~0.01. Receipt text is almost never adversarial. But this step is non-negotiable — the same pipeline handles all text, and a receipt could theoretically contain injection text (e.g., a restaurant named "Ignore previous instructions").

#### Step 5 — Ingestion LLM extracts structured data

Ingestion sends the OCR text to its LLM (Haiku, for cost) with a structured extraction prompt. The LLM returns:

```json
{
  "merchant": "Blue Plate Cafe",
  "date": "2026-05-26",
  "items": [
    {"name": "Grilled Chicken Sandwich", "amount": 14.99},
    {"name": "Side Salad", "amount": 5.99},
    {"name": "Sparkling Water", "amount": 3.50},
    {"name": "Kombucha", "amount": 6.99}
  ],
  "subtotal": 31.47,
  "tax": 2.20,
  "total": 33.67,
  "payment_method": "Visa ****4821",
  "category": "restaurant"
}
```

#### Step 6 — Ingestion emits structured records

One transaction emission for the total:

```sql
INSERT INTO ingestion_emissions (type, status, payload, source_type, source_ref, risk_score)
VALUES ('transaction', 'pending', '{
    "date": "2026-05-26",
    "merchant_normalized": "Blue Plate Cafe",
    "category": "restaurant",
    "amount": -33.67,
    "line_items": [
        {"name": "Grilled Chicken Sandwich", "amount": 14.99},
        {"name": "Side Salad", "amount": 5.99},
        {"name": "Sparkling Water", "amount": 3.50},
        {"name": "Kombucha", "amount": 6.99}
    ],
    "tax": 2.20,
    "payment_method": "Visa ****4821",
    "account_hint": "Visa ****4821"
}', 'telegram_file', '/archive/2026/05/receipts/2026-05-26T12:47:00Z_blue-plate-cafe.jpg', 0.01);
```

Plus a merchant entity emission if Blue Plate Cafe is new.

The raw image is archived to B2 before any emissions are written.

#### Step 7 — The agent validates, resolves, writes

Same as CSV walkthrough steps 8-9. The agent resolves the account (`Visa ****4821` → matches the Chase Sapphire entity by the last-four-digits fact). Resolves the merchant. Writes the transaction.

**Key difference from CSV:** receipt transactions include line items, stored as JSONB in the `properties` column.

#### Step 8 — The agent confirms

*"Receipt from Blue Plate Cafe — $33.67 (restaurant). 4 items including a $6.99 kombucha. Logged to Chase Sapphire."*

#### What line items enable

Line items are what make the system able to say *"You've spent $48 on kombucha this month."* Without them, all you know is that you spent $33.67 at Blue Plate Cafe. With them, the system can aggregate spending on specific items across merchants.

This is a significant schema decision: line items are expensive to store and query but enable the most useful financial insights. See schema implications below.

---

### Walkthrough 3: Querying — "How much did I spend eating out this month?"

**Scenario:** You send a Telegram message: *"How much did I spend eating out this month?"*

#### Step 1 — Telegram message → event queue

grammY receives the text message, creates a high-priority event:

```typescript
queue.push({
  type: "user_message",
  priority: "high",
  payload: {
    text: "How much did I spend eating out this month?",
    chat_id: 12345
  }
});
```

#### Step 2 — The event loop picks up the event

The event loop drains the queue and picks the highest-priority event. It's a user message, so it goes through the full context assembly pipeline.

#### Step 3 — Context assembly builds the prompt

**Layer 1 (stable prefix):** System prompt, tool definitions, user preferences. Cached. Includes the tool definition for `query_finances` (or whatever the financial query tool is named). ~2,000 tokens.

**Layer 2 (daily prefix):** Today's calendar, active tasks, pending items. If there's a financial alert active (e.g., "3 bills due Friday"), it appears here. Cached within the day. ~2,000 tokens.

**Layer 3 (recent prefix):** Condensed context from recent conversations. If you discussed finances yesterday, that context is here. ~500-2,000 tokens.

**Layer 4 (raw conversation):** The new user message: *"How much did I spend eating out this month?"* Plus any recent messages in the current conversation thread.

**No query-specific retrieval yet** — the LLM hasn't decided what data it needs.

Total prompt sent to the LLM: ~5,000-8,000 tokens.

#### Step 4 — LLM reasons and calls a tool

The LLM receives the prompt and decides it needs financial data. It calls:

```json
{
  "tool": "query_finances",
  "input": {
    "query_type": "spending_by_category",
    "categories": ["restaurant", "dining", "food_and_drink"],
    "date_range": {
      "start": "2026-05-01",
      "end": "2026-05-31"
    },
    "group_by": "merchant"
  }
}
```

Note: the LLM interprets "eating out" as restaurant/dining categories, excludes groceries. This is a judgment call by the LLM — and it might be wrong. If the user later says "I meant groceries too," that's a preference correction that should be stored.

#### Step 5 — Tool executes the query

The `query_finances` tool translates the LLM's request to SQL:

```sql
SELECT
    m.name AS merchant,
    COUNT(*) AS transaction_count,
    SUM(ABS(t.amount)) AS total_spent,
    MIN(t.date) AS first_transaction,
    MAX(t.date) AS last_transaction
FROM transactions t
JOIN entities m ON t.merchant_id = m.id
WHERE t.category IN ('restaurant', 'dining', 'food_and_drink')
  AND t.date >= '2026-05-01'
  AND t.date <= '2026-05-31'
  AND t.amount < 0  -- expenses only
GROUP BY m.name
ORDER BY total_spent DESC;
```

The tool also runs a comparison query for context:

```sql
-- Same query for the previous month, for comparison
SELECT SUM(ABS(t.amount)) AS total_spent
FROM transactions t
WHERE t.category IN ('restaurant', 'dining', 'food_and_drink')
  AND t.date >= '2026-04-01'
  AND t.date <= '2026-04-30'
  AND t.amount < 0;
```

The tool formats results for the LLM:

```
Dining spending, May 2026 (as of May 26):

  Blue Plate Cafe:     $142.38  (4 visits)
  Chipotle:            $89.50   (7 visits)
  Sushi House:         $67.00   (2 visits)
  Kombucha Town:       $51.92   (4 visits)
  Other (6 merchants): $183.40  (11 visits)

  Total: $534.20 across 28 transactions
  April comparison: $412.85 (full month)
  Pace: on track for ~$576 by end of month (+39% vs April)
```

This is context engineering — the tool doesn't just return raw data. It computes the comparison and the pace projection so the LLM doesn't have to do math (LLMs are bad at math).

#### Step 6 — LLM formulates response

The LLM receives the tool result and composes a response. The daily prefix and recent prefix give it additional context — maybe you mentioned wanting to cut spending, or there's a bill coming Friday.

#### Step 7 — The agent delivers response via Telegram

```
You've spent $534 eating out this month across 28 transactions.
Top spots: Blue Plate Cafe ($142), Chipotle ($90), Sushi House ($67).

That's up 39% from April ($413). On pace for ~$576 by month end.
```

If the daily prefix contained a financial alert, the LLM might add: *"Worth noting — you have $2,400 in bills landing Friday."*

#### Step 8 — Conversation persisted

The user message and assistant response are written to the `conversations` table. If the LLM extracted any preferences from this interaction (e.g., the user seems interested in tracking dining spend), it could call `remember` to store that as a preference — but for a simple query like this, it probably doesn't.

#### What made this fast

- The `transactions` table is indexed on `(category, date)` — the SQL query runs in single-digit milliseconds.
- The LLM made one tool call, not five. The `query_finances` tool did the aggregation, comparison, and formatting in application code.
- Prompt caching means Layers 1 and 2 (~4,000 tokens) are a cache hit. The billable input is only Layers 3 and 4 (~2,000-4,000 tokens).
- Total cost of this interaction: ~$0.01-0.03 depending on model.

---

### Walkthrough 4: Proactive Alert — "Three bills land Friday, balance is low"

**Scenario:** It's Wednesday morning. The daily briefing is being assembled. The event engine has three bill-due events on Friday, and the knowledge graph has a recent checking account balance.

This walkthrough shows how financial data feeds into the proactive system without you asking.

#### Step 1 — Event engine fires the daily briefing

The event processing loop (every 60 seconds) finds a pending reminder: the daily briefing, scheduled for 7:00 AM. It pushes a normal-priority event into the queue:

```typescript
queue.push({
  type: "scheduled",
  priority: "normal",
  payload: { trigger: "daily_briefing" }
});
```

#### Step 2 — The event loop picks up the event and loads the skill

The event loop processes the event. It calls `fetch_skill("daily_briefing")` to load the skill body, which contains instructions for what to include.

#### Step 3 — The agent calls tools to gather briefing data

The LLM, guided by the skill instructions, makes several tool calls:

**Tool call 1: `get_calendar`**
```json
{"start": "2026-05-27", "end": "2026-05-30"}
```
Returns today's meetings and the rest of the week.

**Tool call 2: `manage_events`**
```json
{"action": "list", "filter": "upcoming", "days": 3}
```
Returns:
```
Upcoming events (next 3 days):
- [HIGH] Property tax payment due — Friday May 29 — $1,842.00
- [MEDIUM] Electric bill due — Friday May 29 — $187.00
- [MEDIUM] Internet bill due — Friday May 29 — $89.00
- [LOW] Gym membership renewal — Saturday May 30 — $49.00
```

**Tool call 3: `query_finances`**
```json
{"query_type": "account_balances"}
```
Returns:
```
Account balances (as of last sync):
- Chase Checking: $2,156.42 (synced May 26)
- Chase Sapphire: -$1,247.83 (statement balance, due Jun 5)
```

**Tool call 4: `query_knowledge`**
```json
{"question": "recent financial facts and pending items"}
```
Returns any recent financial facts from the knowledge graph.

#### Step 4 — LLM detects the problem

The LLM now has all the data in its context:
- Three bills totaling $2,118 land Friday
- Checking balance is $2,156.42
- That leaves $38.42 after bills — dangerously low

The skill instructions tell the LLM to flag financial conflicts. The LLM composes the relevant section of the briefing.

#### Step 5 — Briefing delivered via Telegram

The briefing arrives as a single Telegram message. The financial section:

```
⚠️ Cash flow alert: Three bills totaling $2,118 hit Friday.
  - Property tax: $1,842
  - Electric: $187
  - Internet: $89

Checking balance: $2,156. That leaves $38 after payments.

You may want to transfer funds or check if any can be pushed back.
```

This is interleaved with calendar events, task updates, and other briefing content.

#### Step 6 — User responds (optional)

If you reply — *"Can I push the internet bill?"* — that's a new high-priority user message. The LLM has the briefing context in Layer 4 (raw conversation) and can reason about it. It might check the event for a grace period, or surface a fact about late fees from the knowledge graph.

#### What made the proactive alert possible

- **Bill due dates** are events in the `events` table, created when you set them up or extracted from email notifications.
- **Account balances** are facts in the knowledge graph, updated each time a CSV is imported or Plaid syncs (Version 3).
- **The connection** between "bills are due" and "balance might be insufficient" happens in the LLM's reasoning layer during briefing assembly — not in a hardcoded rule. The LLM sees both data points in the same context and draws the conclusion.
- This is why context assembly matters more than any individual feature.

---

### Walkthrough 5: Email Notification — Bank Balance Alert

**Scenario:** Your bank sends an email: *"Your Chase Checking balance is $2,156.42 as of 05/26/2026."*

This is a simpler path — it shows how financial data arrives passively through email ingestion.

#### Step 1 — Email arrives in the inbox

The email polling job in the ingestion container (every 15 minutes) fetches new emails via the Gmail API.

#### Step 2 — Archive first

The raw email is uploaded to B2 before any processing:
```
files/2026/05/emails/2026-05-26T08:00:00Z_from-chase_balance-alert.json
```

#### Step 3 — Injection classifier scores the email

Score: ~0.03. Bank notification emails are formulaic and low-risk.

#### Step 4 — Email triage classifier

The ingestion LLM (Haiku) classifies the email as **transactional** — it's an automated notification with structured data, not a human communication. Per [data-lifecycle.md](../data-lifecycle.md), transactional emails get structured data extracted, then the body is discarded from active storage.

#### Step 5 — Ingestion LLM extracts structured data

```json
{
  "type": "balance_notification",
  "account": "Chase Checking",
  "balance": 2156.42,
  "as_of": "2026-05-26",
  "institution": "Chase"
}
```

#### Step 6 — Ingestion emits a fact

```sql
INSERT INTO ingestion_emissions (type, status, payload, source_type, source_ref, risk_score)
VALUES ('fact', 'pending', '{
    "entity_hint": "Chase Checking",
    "attribute": "balance",
    "value": "2156.42",
    "as_of": "2026-05-26"
}', 'email', '/archive/2026/05/emails/2026-05-26T08:00:00Z_from-chase_balance-alert.json', 0.03);
```

#### Step 7 — The agent validates and writes

The agent picks up the emission, resolves `Chase Checking` to the entity, and supersedes the old balance fact:

```sql
-- Close out the old balance
UPDATE facts SET valid_until = now()
WHERE entity_id = 'uuid-chase-checking'
  AND attribute = 'balance'
  AND valid_until IS NULL;

-- Insert the new balance
INSERT INTO facts (entity_id, attribute, value, valid_from, source_ref)
VALUES ('uuid-chase-checking', 'balance', '2156.42',
        '2026-05-26', '/archive/2026/05/emails/...');
```

No Telegram message is sent — this is a routine data update, not an alert. The new balance is silently available for the next query or briefing.

---

### Schema Implications

The current schema (entities, facts, relationships, events) needs extension for financial tracking. Here's what's missing and why.

#### New table: `transactions`

The `facts` table is wrong for transactions. Facts are temporal attributes of entities ("Sarah's employer is Stripe"). Transactions are time-series records with numeric values that need aggregation (SUM, AVG, COUNT, GROUP BY). Storing transactions as facts would mean:

- `value` is TEXT, not a numeric type — no `SUM()` without casting
- No `merchant_id` foreign key — can't join to merchant entities efficiently
- No `category` column — would need to be encoded in `attribute` and parsed back out
- No `line_items` support
- Every `SELECT SUM()` would scan the entire facts table, not just transactions

```sql
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES entities(id),
    date DATE NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    transaction_type TEXT NOT NULL DEFAULT 'expense',  -- 'expense', 'income', 'transfer'
    linked_transaction_id UUID REFERENCES transactions(id),  -- pairs both sides of a transfer
    merchant_id UUID REFERENCES entities(id),
    merchant_raw TEXT,                    -- original description from bank/receipt
    category TEXT,
    description TEXT,
    source TEXT NOT NULL,                 -- 'csv_import', 'receipt_ocr', 'email_extraction', 'manual'
    source_ref TEXT,                      -- link to archive original
    properties JSONB DEFAULT '{}',        -- line items, tax, payment method, etc.
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_transactions_date ON transactions (date);
CREATE INDEX idx_transactions_category_date ON transactions (category, date);
CREATE INDEX idx_transactions_account ON transactions (account_id);
CREATE INDEX idx_transactions_merchant ON transactions (merchant_id);
CREATE INDEX idx_transactions_type ON transactions (transaction_type);
```

Scope: liquid cash accounts only (checking, savings, credit cards). Investment accounts are out of scope.

The `transaction_type` column distinguishes real spending from money moving between accounts. When ingestion sees `PAYMENT THANK YOU` on a credit card or `TRANSFER TO SAVINGS` on checking, it emits the transaction as type `transfer`. The agent auto-links the two sides when amounts match across accounts on the same date using `linked_transaction_id`. Spending summaries filter to `transaction_type = 'expense'` so transfers don't inflate totals.

This table is **not append-only** in the knowledge-graph sense — transactions can be corrected (wrong category, wrong merchant match). But the audit log captures every change, and the raw source (CSV, receipt image) is in the archive.

#### Line items: JSONB column vs. separate table

Two options for receipt line items:

Line items are stored as JSONB in the `properties` column:

```json
{
  "line_items": [
    {"name": "Grilled Chicken Sandwich", "amount": 14.99},
    {"name": "Kombucha", "amount": 6.99}
  ],
  "tax": 2.20
}
```

Simple, no joins, works for display. Item-level queries across transactions (e.g., "total spent on kombucha") can use JSONB operators (`jsonb_array_elements`) if ever needed, but this isn't expected to be a common query pattern. If it becomes one, a separate `transaction_items` table can be added later without changing the ingestion pipeline — the data is already captured.

#### New tool: `query_finances`

The existing `query_knowledge` tool is wrong for financial queries. It searches entities, facts, and relationships — not transaction aggregates. Financial queries need:

- Aggregation (SUM, AVG, COUNT)
- Date-range filtering
- Category grouping
- Comparison to previous periods
- Pace projection (spending rate extrapolated to month end)

This is a dedicated tool that runs SQL against the `transactions` table and formats results for the LLM. The tool does the math — not the LLM.

```
Tool: query_finances
Input:
  - query_type: 'spending_summary' | 'spending_by_category' | 'spending_by_merchant' |
                'account_balances' | 'upcoming_bills' | 'transaction_search' | 'trends'
  - date_range: { start, end }
  - categories: string[]  (optional filter)
  - merchants: string[]   (optional filter)
  - accounts: string[]    (optional filter)
  - compare_to: 'previous_period' | 'same_period_last_year'  (optional)
Output:
  Formatted text with aggregates, comparisons, and projections.
```

#### Emission type: `transaction`

The emission schema in [version-two.md](version-two.md) Phase 3 lists `entity`, `fact`, `relationship`, `event`, and `embedding_chunk` as emission types. Financial tracking needs `transaction` added:

```json
{
  "type": "transaction",
  "payload": {
    "date": "2026-05-01",
    "amount": -87.43,
    "merchant_normalized": "Trader Joe's",
    "merchant_raw": "TRADER JOES #123",
    "category": "groceries",
    "account_hint": "Chase Sapphire",
    "line_items": [],
    "source_detail": {}
  }
}
```

#### Processing request coordination

Walkthroughs 1 and 2 both require a coordination mechanism between the agent and ingestion for file processing. This is a known design gap. The `processing_requests` table used here needs to be designed alongside the `search_requests` table for web search — they're the same pattern (the agent tells ingestion to do work, ingestion reads the request).

```sql
CREATE TABLE processing_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL,              -- 'file_parse', 'web_search', 'email_sync'
    source_type TEXT NOT NULL,       -- 'telegram_file', 'drive_file', 'user_request'
    file_path TEXT,
    status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'processing', 'completed', 'failed'
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
```

Ingestion needs SELECT + UPDATE on this table (to claim and complete requests). This is a controlled expansion of ingestion's database access — it can read requests and update their status, but still can't read the knowledge graph.

#### Category taxonomy

The LLM assigns categories to transactions during ingestion. No fixed taxonomy — the LLM uses its judgment, and category consistency improves over time as corrections are stored as preferences.

When the user corrects a category ("that's not dining, that's groceries"), the correction is stored as a preference fact (e.g., `"Trader Joe's" → "groceries"`). The ingestion LLM sees accumulated category preferences in its prompt, so it learns the user's mental model rather than imposing a rigid list. Bank-provided categories are available as a hint but not authoritative — different banks categorize differently, and the user's categories should be consistent across accounts.

#### Transaction deduplication

The same purchase can enter the system through multiple paths — a receipt photo sent via Telegram and the same charge appearing later in a CSV bank statement. Without deduplication, spending totals are inflated.

**How duplicates arise:**

- You photograph a receipt at Blue Plate Cafe ($33.67) and send it to the bot on Monday
- You download your credit card CSV on Friday — it includes the same $33.67 charge at Blue Plate Cafe from Monday

**Detection strategy:**

When the agent processes a new transaction emission, it checks for existing transactions that match on:

1. **Amount** — exact match on `amount`
2. **Date** — within a ±3 day window (post dates often differ from transaction dates by 1-2 days)
3. **Account** — same `account_id` (or same account inferred from last-four-digits matching)
4. **Merchant** — fuzzy match on merchant name (receipt says "Blue Plate Cafe", CSV says "BLUE PLATE CAFE SLC")

If all four match, it's a probable duplicate. The agent's behavior:

- **High confidence duplicate** (exact amount + same date + same merchant after normalization): auto-merge silently. Keep the richer record — the receipt version has line items, the CSV version has the bank's metadata. Merge both into a single transaction with combined `properties`. Log the merge in the audit log.
- **Medium confidence** (amount matches but date is off by 2-3 days, or merchant name is ambiguous): ask the user via Telegram. *"Is this $33.67 at Blue Plate Cafe from your receipt the same as the $33.67 BLUE PLATE CAFE charge on your Chase statement?"*
- **Low confidence** (only amount matches): treat as separate transactions.

**Schema support:**

The `source` column already tracks where a transaction came from (`receipt_ocr` vs `csv_import`). When merging, both sources are preserved in `properties`:

```json
{
  "sources": ["receipt_ocr", "csv_import"],
  "line_items": [...],
  "original_description": "BLUE PLATE CAFE SLC"
}
```

The `source_ref` points to the primary source; additional source refs go into `properties`. Both the receipt image and the CSV row remain in the B2 archive regardless of the merge.
