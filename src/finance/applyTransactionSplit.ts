import { db } from "@/db.ts";

// Amounts are NUMERIC(12,2), so anything under half a cent is rounding noise rather than a real
// disagreement with the receipt.
const CENT_TOLERANCE = 0.005;

export interface SplitPart {
  category: string;
  amount: number;
  person?: string;
}

export interface ApplyTransactionSplitResult {
  ok: boolean;
  problem?: string;
  total?: number;
  // Canonicalized names, so the reply reports what was stored rather than what was typed.
  parts?: SplitPart[];
}

export async function applyTransactionSplit(
  transactionId: string,
  parts: SplitPart[],
): Promise<ApplyTransactionSplitResult> {
  const rows = await db`
    SELECT amount FROM transactions WHERE id = ${transactionId} AND removed_at IS NULL
  ` as unknown as { amount: number }[];

  if (rows.length === 0) return { ok: false, problem: "No such transaction." };

  const charge = rows[0].amount;
  const amountProblem = validateAmounts(parts, charge);
  if (amountProblem) return { ok: false, problem: amountProblem };

  // Names are checked here rather than left to the foreign key, because a raw
  // "violates foreign key constraint" tells the model nothing it can act on. Resolving
  // case-insensitively also lets a lowercase "groceries" through as "Groceries".
  const resolved = await resolveNames(parts);
  if ("problem" in resolved) return { ok: false, problem: resolved.problem };

  await db.begin(async (tx) => {
    await tx`DELETE FROM transaction_splits WHERE transaction_id = ${transactionId}`;
    for (const part of resolved.parts) {
      await tx`
        INSERT INTO transaction_splits (transaction_id, category, person, amount)
        VALUES (${transactionId}, ${part.category}, ${part.person ?? null}, ${part.amount})
      `;
    }
    await tx`
      UPDATE transactions SET needs_category = false, category_source = 'manual', updated_at = now()
      WHERE id = ${transactionId}
    `;
  });

  return { ok: true, total: charge, parts: resolved.parts };
}

// Plaid signs a refund negative, so "every part positive" would reject a legitimate split of a
// returned purchase. The rule is that every part shares the charge's sign and the parts sum to it.
function validateAmounts(parts: SplitPart[], charge: number): string | undefined {
  if (parts.length === 0) return "A split needs at least one part.";

  if (parts.some((part) => Math.sign(part.amount) !== Math.sign(charge))) {
    return charge < 0
      ? "This is a refund, so every part must be negative."
      : "Every part must be positive.";
  }

  const sum = parts.reduce((running, part) => running + part.amount, 0);
  if (Math.abs(sum - charge) > CENT_TOLERANCE) {
    return `The parts total ${sum.toFixed(2)} but the charge is ${charge.toFixed(2)}. ` +
      `They must match — adjust a part or add one for the difference.`;
  }

  return undefined;
}

async function resolveNames(
  parts: SplitPart[],
): Promise<{ parts: SplitPart[] } | { problem: string }> {
  const [categories, people] = await Promise.all([
    db`SELECT name FROM categories WHERE active ORDER BY sort_order` as unknown as Promise<
      { name: string }[]
    >,
    db`SELECT name FROM people ORDER BY name` as unknown as Promise<{ name: string }[]>,
  ]);

  const categoryByLower = new Map(categories.map((row) => [row.name.toLowerCase(), row.name]));
  const personByLower = new Map(people.map((row) => [row.name.toLowerCase(), row.name]));

  const resolved: SplitPart[] = [];

  for (const part of parts) {
    const category = categoryByLower.get(part.category.toLowerCase());
    if (!category) {
      return {
        problem: `No such category: "${part.category}". Valid categories: ${
          categories.map((row) => row.name).join(", ")
        }.`,
      };
    }

    if (part.person === undefined) {
      resolved.push({ ...part, category });
      continue;
    }

    const person = personByLower.get(part.person.toLowerCase());
    if (!person) {
      return {
        problem: `No such person: "${part.person}". Valid: ${
          people.map((row) => row.name).join(", ")
        }.`,
      };
    }
    resolved.push({ ...part, category, person });
  }

  return { parts: resolved };
}
