import * as v from "valibot";
import { createFinanceCategory } from "@/finance/createFinanceCategory.ts";
import { requirePrivateChat } from "@/finance/requirePrivateChat.ts";
import { parseToolInput } from "@/tools/parseToolInput.ts";
import type { ToolDefinition, ToolResult } from "@/tools/toolTypes.ts";
import { trace } from "@/trace.ts";

const inputSchema = v.object({
  name: v.pipe(v.string(), v.minLength(2), v.maxLength(60)),
});

export const createFinanceCategoryTool: ToolDefinition = {
  schema: {
    name: "create_finance_category",
    description:
      "Create one finance category. Ask the user for explicit permission first. Call this tool only after the user replies in a later message with clear approval to create this named category. A category suggestion or categorization answer is not permission. Never call this tool in the same turn that asks for permission.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "The exact approved category name.",
        },
      },
      required: ["name"],
    },
  },
  handle: handleCreateFinanceCategory,
};

async function handleCreateFinanceCategory(
  input: Record<string, unknown>,
  traceId: string,
  telegramChatId?: number | null,
): Promise<ToolResult> {
  const refusal = requirePrivateChat(telegramChatId);
  if (refusal) return refusal;

  const parsed = parseToolInput(
    inputSchema,
    input,
    '{ name: "Travel" }',
  );
  if (!parsed.success) return parsed.error;

  const result = await createFinanceCategory(parsed.data.name);
  await trace(traceId, "finance.category_created", { ...result });
  return {
    content: JSON.stringify({
      operation: "create_finance_category",
      ...result,
    }),
  };
}
