import type { MessageParam } from "@/anthropic/mod.ts";
import { loadRecentMessages } from "@/context/conversation.ts";
import { truncateToTokenBudget } from "@/context/tokens.ts";
import { buildSystemPrompt } from "@/context/stable-prefix.ts";

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
