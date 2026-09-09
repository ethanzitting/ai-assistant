import type { ToolDefinition, ToolResult } from "@/tools/toolTypes.ts";
import { parseToolInput } from "@/tools/parseToolInput.ts";
import { setCategoryRuleInputSchema } from "@/finance/setCategoryRuleSchema.ts";
import { requirePrivateChat } from "@/finance/requirePrivateChat.ts";
import { applyCategoryRule } from "@/finance/applyCategoryRule.ts";
import { trace } from "@/trace.ts";

export const setCategoryRuleTool: ToolDefinition = {
  schema: {
    name: "set_category_rule",
    description:
      "Create a permanent category rule only when the user explicitly says 'always', 'from now on', or equivalent. A one-time category answer is not permission to create a rule. The rule applies to matching transactions already stored AND to future ones, so past totals change immediately — say so when reporting the result. Call once per rule. Prefer match_type 'merchant' when the merchant name is known; use 'description_contains' when only the raw bank text identifies it.",
    inputSchema: {
      type: "object" as const,
      properties: {
        match_type: {
          type: "string",
          enum: ["merchant", "description_contains"],
          description:
            "'merchant' matches the merchant name exactly, ignoring case. 'description_contains' matches any part of the raw bank description.",
        },
        match_value: {
          type: "string",
          description:
            "The merchant name, or the text to look for in the description.",
        },
        category: {
          type: "string",
          description:
            "The category to assign, lowercase, e.g. 'groceries'. Reuse an existing category name where one fits.",
        },
      },
      required: ["match_type", "match_value", "category"],
    },
  },
  handle: handleSetCategoryRule,
};

async function handleSetCategoryRule(
  input: Record<string, unknown>,
  traceId: string,
  telegramChatId?: number | null,
): Promise<ToolResult> {
  const refusal = requirePrivateChat(telegramChatId);
  if (refusal) return refusal;

  const parsed = parseToolInput(
    setCategoryRuleInputSchema,
    input,
    '{ match_type: "merchant"|"description_contains", match_value: "Trader Joe\'s", category: "groceries" }',
  );
  if (!parsed.success) return parsed.error;

  const { match_type: matchType, match_value: matchValue, category } =
    parsed.data;
  const result = await applyCategoryRule({ matchType, matchValue, category });

  await trace(traceId, "finance.category_rule", {
    matchType,
    matchValue,
    category,
    ...result,
  });

  if (result.refusedAsTooBroad) {
    return {
      content:
        `Not saved — "${matchValue}" matches ${result.refusedAsTooBroad} transactions, which is too ` +
        `broad to rewrite in one step. Use a more specific match_value, or 'merchant' instead of ` +
        `'description_contains'.`,
      isError: true,
    };
  }

  return {
    content: result.updated === 0
      ? `Rule saved: ${matchValue} → ${category}. No stored transactions matched, so it applies to future ones.`
      : `Rule saved: ${matchValue} → ${category}. Recategorized ${result.updated} existing transaction(s), so past totals for both categories have changed.`,
  };
}
