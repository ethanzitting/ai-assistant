import * as v from "valibot";
import type { ToolDefinition, ToolResult } from "@/tools/toolTypes.ts";
import { parseToolInput } from "@/tools/parseToolInput.ts";
import { requirePrivateChat } from "@/finance/requirePrivateChat.ts";
import { applyTransactionSplit } from "@/finance/applyTransactionSplit.ts";
import { formatMoney } from "@/finance/formatMoney.ts";
import { trace } from "@/trace.ts";

const splitTransactionInputSchema = v.object({
  transaction_id: v.pipe(v.string(), v.uuid()),
  splits: v.pipe(
    v.array(v.object({
      category: v.pipe(v.string(), v.minLength(2)),
      amount: v.number(),
      person: v.optional(v.string()),
    })),
    v.minLength(1),
  ),
});

export const splitTransactionTool: ToolDefinition = {
  schema: {
    name: "split_transaction",
    description:
      "Divide one charge across several categories — a Walmart run that was part groceries and part household, or a receipt the user photographed. Get the transaction_id from list_pending_categorizations or query_finances. The parts MUST add up to the charge total exactly; if they do not, the call is rejected and nothing is written. State the split you are about to make in the chat before calling, so a misread receipt is visible. Replaces any previous split on that charge. Optionally attribute a part to a person.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transaction_id: { type: "string", description: "The charge's id." },
        splits: {
          type: "array",
          description: "The parts. Must sum to the charge total.",
          items: {
            type: "object",
            properties: {
              category: { type: "string", description: "An exact category name from the list." },
              amount: {
                type: "number",
                description: "Positive for a purchase, negative for a refund.",
              },
              person: { type: "string", description: "Optional: Ethan or Betsy." },
            },
            required: ["category", "amount"],
          },
        },
      },
      required: ["transaction_id", "splits"],
    },
  },
  handle: handleSplitTransaction,
};

async function handleSplitTransaction(
  input: Record<string, unknown>,
  traceId: string,
  telegramChatId?: number | null,
): Promise<ToolResult> {
  const refusal = requirePrivateChat(telegramChatId);
  if (refusal) return refusal;

  const parsed = parseToolInput(
    splitTransactionInputSchema,
    input,
    '{ transaction_id: "uuid", splits: [{ category: "Groceries", amount: 120.00, person?: "Ethan" }] }',
  );
  if (!parsed.success) return parsed.error;

  const { transaction_id: transactionId, splits } = parsed.data;
  const result = await applyTransactionSplit(transactionId, splits);

  await trace(traceId, "finance.split", { transactionId, parts: splits.length, ok: result.ok });

  if (!result.ok) return { content: result.problem ?? "Could not split.", isError: true };

  const summary = (result.parts ?? splits)
    .map((part) => `${part.category} ${formatMoney(part.amount)}${part.person ? ` (${part.person})` : ""}`)
    .join(", ");

  return { content: `Split ${formatMoney(result.total ?? 0)} into ${summary}.` };
}
