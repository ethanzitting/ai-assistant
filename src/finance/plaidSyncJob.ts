import { db } from "@/db.ts";
import { runPlaidSync } from "@/finance/runPlaidSync.ts";
import { reportSyncIssue } from "@/finance/reportSyncIssue.ts";
import { countRecentFailures } from "@/finance/countRecentFailures.ts";
import { detectSyncStall } from "@/finance/detectSyncStall.ts";
import { PlaidError } from "@/plaid/plaidError.ts";
import { info } from "@/logger.ts";

const FAILURES_BEFORE_REPORT = 3;

export async function plaidSyncJob(jobName: string): Promise<Record<string, unknown>> {
  // The job is seeded by migration 017 and starts ticking before any bank is linked. Without this
  // it would fail every six hours and then report a problem that is only "not set up yet".
  if (!Deno.env.get("PLAID_ACCESS_TOKEN")) {
    info("finance", "Plaid sync skipped — no PLAID_ACCESS_TOKEN set");
    return { skipped: "no_access_token" };
  }

  try {
    const result = await runPlaidSync();

    const stallMessage = result.added === 0 ? await detectSyncStall(jobName) : null;
    if (stallMessage) await reportSyncIssue(stallMessage);

    return { ...result, stall_reported: stallMessage !== null };
  } catch (err: unknown) {
    await reportFailure(jobName, err);
    throw err;
  }
}

async function reportFailure(jobName: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);

  if (err instanceof PlaidError && err.isItemError) {
    await reportItemError(err, message);
    return;
  }

  // Report on the third failure only. Below that it is usually one flaky network call, and above it
  // the streak has already been reported once, which is enough.
  const priorFailures = await countRecentFailures(jobName);
  if (priorFailures + 1 !== FAILURES_BEFORE_REPORT) return;

  await reportSyncIssue(
    `⚠️ The bank sync has now failed ${FAILURES_BEFORE_REPORT} times in a row.\n\n${message}`,
  );
}

// An ITEM_ERROR does not clear on its own: every later sync returns nothing until the bank
// connection is re-linked, and an empty sync reads as "no spending" rather than as a fault. Report
// it once per episode, tracked by the item's own status rather than by a counter.
// Unscoped by design: one PLAID_ACCESS_TOKEN means one Item, and a failure in fetchBalances gives
// no item_id to scope by. Whoever adds a second access token must scope this UPDATE, or one dead
// connection will flag both and swallow the report for the second one.
async function reportItemError(err: PlaidError, message: string): Promise<void> {
  const reflagged = await db`
    UPDATE plaid_items SET status = 'login_required'
    WHERE status IS DISTINCT FROM 'login_required'
    RETURNING item_id
  `;

  const [{ count }] = await db`
    SELECT count(*)::int AS count FROM plaid_items
  ` as unknown as [{ count: number }];

  const alreadyFlagged = reflagged.length === 0 && count > 0;
  if (alreadyFlagged) return;

  await reportSyncIssue(
    `🔴 The bank connection needs attention (${err.errorCode}).\n\n${message}\n\n` +
      `Transaction syncing is stopped until it is re-linked. ` +
      `Run \`scripts/plaid-link.ts\` to reconnect.`,
  );
}
