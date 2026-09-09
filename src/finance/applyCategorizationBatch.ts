import * as v from "valibot";
import { db } from "@/db.ts";
import { requirePrivateChat } from "@/finance/requirePrivateChat.ts";
import { parseToolInput } from "@/tools/parseToolInput.ts";
import type { ToolDefinition, ToolResult } from "@/tools/toolTypes.ts";
import { trace } from "@/trace.ts";

const inputSchema = v.object({
  batch_id: v.pipe(v.string(), v.uuid()),
  answers: v.pipe(
    v.array(v.object({
      label: v.pipe(v.string(), v.regex(/^[A-Z]$/)),
      category: v.pipe(v.string(), v.minLength(2)),
    })),
    v.minLength(1),
  ),
});

export const applyCategorizationBatchTool: ToolDefinition = {
  schema: {
    name: "apply_categorization_batch",
    description:
      "Apply clear single-category answers to items in the finance batch attached to the user's reply. Use only the batch_id and labels supplied in that reply context. Do not use this for splits, receipts, or vendor rules.",
    inputSchema: {
      type: "object" as const,
      properties: {
        batch_id: { type: "string" },
        answers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: {
                type: "string",
                description: "The batch label, for example A.",
              },
              category: {
                type: "string",
                description: "An exact user category name.",
              },
            },
            required: ["label", "category"],
          },
        },
      },
      required: ["batch_id", "answers"],
    },
  },
  handle: applyCategorizationBatch,
};

async function applyCategorizationBatch(
  input: Record<string, unknown>,
  traceId: string,
  telegramChatId?: number | null,
): Promise<ToolResult> {
  const refusal = requirePrivateChat(telegramChatId);
  if (refusal) return refusal;

  const parsed = parseToolInput(
    inputSchema,
    input,
    '{ batch_id: "uuid", answers: [{ label: "A", category: "Groceries" }] }',
  );
  if (!parsed.success) return parsed.error;

  const result = await applyAnswers(parsed.data.batch_id, parsed.data.answers);
  if ("problem" in result) return { content: result.problem, isError: true };

  await trace(traceId, "finance.categorization_batch", {
    batchId: parsed.data.batch_id,
    labels: parsed.data.answers.map((answer) => answer.label),
  });
  return {
    content: JSON.stringify({
      operation: "categorize",
      changed: true,
      answers: result.answers,
    }),
  };
}

async function applyAnswers(
  batchId: string,
  answers: { label: string; category: string }[],
): Promise<
  { answers: { label: string; category: string }[] } | { problem: string }
> {
  const labels = answers.map((answer) => answer.label);
  if (new Set(labels).size !== labels.length) {
    return { problem: "Each batch label can have only one answer." };
  }

  const categories =
    await db`SELECT name FROM categories WHERE active` as unknown as {
      name: string;
    }[];
  const categoryByLower = new Map(
    categories.map((row) => [row.name.toLowerCase(), row.name]),
  );
  const canonicalAnswers = answers.map((answer) => ({
    label: answer.label,
    category: categoryByLower.get(answer.category.toLowerCase()),
  }));
  const unknown = canonicalAnswers.find((answer) => !answer.category);
  if (unknown) return { problem: `Unknown category for ${unknown.label}.` };

  const resolved = canonicalAnswers as { label: string; category: string }[];
  return await db.begin(async (tx) => {
    const items = await tx`
      SELECT label, transaction_id FROM categorization_batch_items
      WHERE batch_id = ${batchId} AND label = ANY(${labels}) AND answered_at IS NULL
      FOR UPDATE
    ` as unknown as { label: string; transaction_id: string }[];
    if (items.length !== resolved.length) {
      return { problem: "One or more batch items are no longer open." };
    }

    const transactionByLabel = new Map(
      items.map((item) => [item.label, item.transaction_id]),
    );
    for (const answer of resolved) {
      const transactionId = transactionByLabel.get(answer.label);
      if (!transactionId) {
        return { problem: `Missing batch item ${answer.label}.` };
      }
      await tx`
        UPDATE transactions SET category = ${answer.category}, category_source = 'manual',
          needs_category = false, updated_at = now()
        WHERE id = ${transactionId} AND needs_category
      `;
      await tx`
        UPDATE categorization_batch_items SET answered_at = now()
        WHERE batch_id = ${batchId} AND label = ${answer.label}
      `;
    }
    await tx`
      UPDATE categorization_batches SET completed_at = now()
      WHERE id = ${batchId} AND NOT EXISTS (
        SELECT 1 FROM categorization_batch_items
        WHERE batch_id = ${batchId} AND answered_at IS NULL
      )
    `;
    return { answers: resolved };
  });
}
