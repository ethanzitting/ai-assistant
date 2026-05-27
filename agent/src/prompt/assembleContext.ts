import type { MessageParam } from "@/anthropic/anthropicExports.ts";
import { loadRecentMessages } from "@/conversation/conversationHistory.ts";
import { truncateToTokenBudget } from "@/prompt/tokenEstimation.ts";
import { buildSystemPrompt } from "@/prompt/systemPrompt.ts";

const CONVERSATION_TOKEN_BUDGET = 20_000;
const MAX_RECENT_MESSAGES = 200;

export async function assembleContext(): Promise<{
  systemPrompt: string;
  messages: MessageParam[];
}> {
  const systemPrompt = await buildSystemPrompt();

  const recentRows = await loadRecentMessages(MAX_RECENT_MESSAGES);
  const chronological = recentRows.reverse();

  const truncated = truncateToTokenBudget(chronological, CONVERSATION_TOKEN_BUDGET);
  const messages = toMessageParams(truncated);

  return { systemPrompt, messages };
}

function toMessageParams(
  rows: { role: string; content: string }[],
): MessageParam[] {
  return rows
    .filter((row) => row.role === "user" || row.role === "assistant")
    .map((row) => ({
      role: row.role as "user" | "assistant",
      content: row.content,
    }));
}
