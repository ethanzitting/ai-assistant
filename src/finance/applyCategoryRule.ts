import { db } from "@/db.ts";
import { escapeLikePattern } from "@/finance/escapeLikePattern.ts";

// A rule rewrites stored history, and there is no undo tool. A description_contains of "an" matches
// 467 of 2,497 transactions here, so the ceiling exists to turn a too-broad rule into a refusal
// rather than a silent bulk rewrite the user only notices later in a total.
const MAX_ROWS_PER_RULE = 500;

export interface ApplyCategoryRuleArgs {
  matchType: "merchant" | "description_contains";
  matchValue: string;
  category: string;
}

export interface ApplyCategoryRuleResult {
  updated: number;
  queueItemsClosed: number;
  refusedAsTooBroad?: number;
}

// The rule is stored AND replayed over history in one go. A correction that only affected future
// transactions would leave every past total wrong while looking like it worked, which teaches the
// user not to trust the numbers. Rows the user corrected by hand are left alone — a rule is a
// weaker signal than an explicit per-transaction decision.
export async function applyCategoryRule(
  args: ApplyCategoryRuleArgs,
): Promise<ApplyCategoryRuleResult> {
  const matching = await countMatching(args);
  if (matching > MAX_ROWS_PER_RULE) {
    return {
      updated: 0,
      queueItemsClosed: 0,
      refusedAsTooBroad: matching,
    };
  }

  return await db.begin(async (tx) => {
    await tx`
      INSERT INTO category_rules (match_type, match_value, category, policy)
      VALUES (${args.matchType}, ${args.matchValue}, ${args.category}, 'auto')
      ON CONFLICT (match_type, match_value)
        DO UPDATE SET category = EXCLUDED.category, policy = 'auto', created_at = now()
    `;

    const updated = args.matchType === "merchant"
      ? await tx`
          UPDATE transactions SET category = ${args.category}, category_source = 'rule',
            needs_category = false, updated_at = now()
          WHERE ${
        rewritable(args)
      } AND lower(merchant_name) = lower(${args.matchValue})
          RETURNING id
        `
      : await tx`
          UPDATE transactions SET category = ${args.category}, category_source = 'rule',
            needs_category = false, updated_at = now()
          WHERE ${rewritable(args)} AND description ILIKE ${
        likePattern(args.matchValue)
      } ESCAPE '\'
          RETURNING id
        `;

    const transactionIds = updated.map((row) => row.id as string);
    const closed = transactionIds.length > 0
      ? await tx`
        UPDATE categorization_batch_items SET answered_at = now()
        WHERE transaction_id = ANY(${transactionIds}) AND answered_at IS NULL
        RETURNING id
      `
      : [];
    if (closed.length > 0) {
      await tx`
        UPDATE categorization_batches b SET completed_at = now()
        WHERE b.completed_at IS NULL AND NOT EXISTS (
          SELECT 1 FROM categorization_batch_items i
          WHERE i.batch_id = b.id AND i.answered_at IS NULL
        )
      `;
    }

    return { updated: updated.length, queueItemsClosed: closed.length };
  });
}

async function countMatching(args: ApplyCategoryRuleArgs): Promise<number> {
  const [{ count }] = args.matchType === "merchant"
    ? await db`
        SELECT count(*)::int AS count FROM transactions
        WHERE ${
      rewritable(args)
    } AND lower(merchant_name) = lower(${args.matchValue})
      ` as unknown as [{ count: number }]
    : await db`
        SELECT count(*)::int AS count FROM transactions
        WHERE ${rewritable(args)} AND description ILIKE ${
      likePattern(args.matchValue)
    } ESCAPE '\'
      ` as unknown as [{ count: number }];

  return count;
}

// A split transaction is excluded because the view reads its category from transaction_splits and
// ignores transactions.category entirely. Without this the rule would update rows that do not
// change any total, and report having recategorized them.
function rewritable(args: ApplyCategoryRuleArgs) {
  return db`
    removed_at IS NULL
    AND transaction_type = 'expense'
    AND category_source IS DISTINCT FROM 'manual'
    AND category IS DISTINCT FROM ${args.category}
    AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = transactions.id)
  `;
}

function likePattern(matchValue: string): string {
  return `%${escapeLikePattern(matchValue)}%`;
}
