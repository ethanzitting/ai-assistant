import * as v from "valibot";
import type { ToolDefinition, ToolResult } from "@/tools/toolTypes.ts";
import { parseToolInput } from "@/tools/parseToolInput.ts";
import { requirePrivateChat } from "@/finance/requirePrivateChat.ts";
import { setVendorPolicy } from "@/finance/setVendorPolicy.ts";
import { resolveActiveCategory } from "@/finance/resolveActiveCategory.ts";
import { trace } from "@/trace.ts";

const setVendorPolicyInputSchema = v.object({
  match_type: v.picklist(["merchant", "description_contains"]),
  match_value: v.pipe(v.string(), v.minLength(3)),
  policy: v.picklist(["auto", "ask"]),
  category: v.optional(v.pipe(v.string(), v.minLength(2))),
});

export const setVendorPolicyTool: ToolDefinition = {
  schema: {
    name: "set_vendor_policy",
    description:
      "Set one permanent merchant policy. Call this only when the user explicitly says 'always', 'keep asking', 'from now on', or equivalent. 'auto' categorizes matching expense history and future expenses. 'ask' queues future matching expenses and does not change history. Use an exact merchant name when available. Use description_contains only when merchant_name is absent.",
    inputSchema: {
      type: "object" as const,
      properties: {
        match_type: {
          type: "string",
          enum: ["merchant", "description_contains"],
        },
        match_value: {
          type: "string",
          description:
            "The merchant name, or text to find in the raw bank description.",
        },
        policy: {
          type: "string",
          enum: ["auto", "ask"],
          description:
            "'auto' categorizes history and future expenses. 'ask' queues future expenses without changing history.",
        },
        category: {
          type: "string",
          description:
            "Required for 'auto'. Case-insensitive user category name. Ignored for 'ask'.",
        },
      },
      required: ["match_type", "match_value", "policy"],
    },
  },
  handle: handleSetVendorPolicy,
};

async function handleSetVendorPolicy(
  input: Record<string, unknown>,
  traceId: string,
  telegramChatId?: number | null,
): Promise<ToolResult> {
  const refusal = requirePrivateChat(telegramChatId);
  if (refusal) return refusal;

  const parsed = parseToolInput(
    setVendorPolicyInputSchema,
    input,
    '{ match_type: "merchant", match_value: "Walmart", policy: "ask" } or { …, policy: "auto", category: "Groceries" }',
  );
  if (!parsed.success) return parsed.error;

  const { match_type: matchType, match_value: matchValue, policy } =
    parsed.data;
  let category = parsed.data.category;

  if (policy === "auto" && !category) {
    return {
      content: JSON.stringify({
        operation: "set_vendor_policy",
        changed: false,
        reason: "auto_policy_requires_category",
      }),
      isError: true,
    };
  }
  if (policy === "auto" && category) {
    const resolved = await resolveActiveCategory(category);
    if (!resolved.category) {
      return {
        content: JSON.stringify({
          operation: "set_vendor_policy",
          changed: false,
          reason: "unknown_category",
          requestedCategory: category,
          validCategories: resolved.validCategories,
        }),
        isError: true,
      };
    }
    category = resolved.category;
  }

  const result = await setVendorPolicy({
    matchType,
    matchValue,
    policy,
    category,
  });
  await trace(traceId, "finance.vendor_policy", {
    matchValue,
    policy,
    category,
    ...result,
  });

  if (result.refusedAsTooBroad) {
    return {
      content: JSON.stringify({
        operation: "set_vendor_policy",
        changed: false,
        reason: "match_too_broad",
        matchingTransactions: result.refusedAsTooBroad,
      }),
      isError: true,
    };
  }

  return {
    content: JSON.stringify({
      operation: "set_vendor_policy",
      changed: true,
      matchType,
      matchValue,
      policy,
      category: category ?? null,
      historyTransactionsChanged: result.updated,
      queueItemsClosed: result.queueItemsClosed,
      futureMatchingExpenses: policy === "auto" ? "categorized" : "queued",
    }),
  };
}
