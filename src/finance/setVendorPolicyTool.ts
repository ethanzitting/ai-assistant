import * as v from "valibot";
import type { ToolDefinition, ToolResult } from "@/tools/toolTypes.ts";
import { parseToolInput } from "@/tools/parseToolInput.ts";
import { requirePrivateChat } from "@/finance/requirePrivateChat.ts";
import { setVendorPolicy } from "@/finance/setVendorPolicy.ts";
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
      "Decide how a merchant is handled from now on. Use this only when the user explicitly says 'always', 'keep asking', 'from now on', or equivalent. policy 'auto' with a category files every charge from that merchant silently AND applies the category to matching charges already stored, so past totals change — say so. policy 'ask' queues every charge from that merchant for a nightly question instead, which is right for a shop that could be several categories, like a supermarket. Use 'merchant' when the merchant name is known and 'description_contains' when only the raw bank text identifies it, which is the case for charges with no merchant name.",
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
            "'auto' files it silently; 'ask' queues it for a nightly question.",
        },
        category: {
          type: "string",
          description:
            "Required for 'auto'. An exact category name. Ignored for 'ask'.",
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

  const { match_type: matchType, match_value: matchValue, policy, category } =
    parsed.data;

  if (policy === "auto" && !category) {
    return { content: "An 'auto' policy needs a category.", isError: true };
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
      content:
        `Not saved — "${matchValue}" matches ${result.refusedAsTooBroad} transactions, too broad ` +
        `to rewrite in one step. Use a more specific match_value.`,
      isError: true,
    };
  }

  if (policy === "ask") {
    return {
      content:
        `Every ${matchValue} charge will be queued for a nightly question.`,
    };
  }

  return {
    content: result.updated === 0
      ? `${matchValue} will file as ${category}. No stored charges matched.`
      : `${matchValue} will file as ${category}. ${result.updated} stored charge(s) moved, so past totals changed.`,
  };
}
