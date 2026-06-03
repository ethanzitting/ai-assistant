import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.mjs";
import { loadRecentMessages, loadChatMessages } from "@/conversationHistory.ts";
import { truncateToTokenBudget } from "@/prompt/tokenEstimation.ts";
import { buildSystemPrompt } from "@/prompt/buildSystemPrompt.ts";

const CONVERSATION_TOKEN_BUDGET = 20_000;
const MAX_RECENT_MESSAGES = 200;
const MIN_RESPONDED_TURNS = 5;

export async function assembleContext(
  internalChatId?: string,
  chatType?: string,
): Promise<{
  systemPrompt: string;
  messages: MessageParam[];
}> {
  const systemPrompt = await buildSystemPrompt(internalChatId, chatType);

  const recentRows = internalChatId
    ? await loadChatMessages(internalChatId, MAX_RECENT_MESSAGES)
    : await loadRecentMessages(MAX_RECENT_MESSAGES);

  const chronological = recentRows.reverse();
  const byTokens = truncateToTokenBudget(chronological, CONVERSATION_TOKEN_BUDGET);
  const byTurns = keepMinRespondedTurns(chronological, MIN_RESPONDED_TURNS);

  const kept = byTurns.length > byTokens.length ? byTurns : byTokens;
  const messages = mergeConsecutiveRoles(toMessageParams(kept));

  return { systemPrompt, messages };
}

function toMessageParams(
  rows: { role: string; content: string }[],
): MessageParam[] {
  return rows
    .filter((row) => row.role === "user" || row.role === "assistant" || row.role === "context")
    .map((row) => ({
      role: (row.role === "context" ? "user" : row.role) as "user" | "assistant",
      content: row.content,
    }));
}

function mergeConsecutiveRoles(messages: MessageParam[]): MessageParam[] {
  if (messages.length === 0) return [];

  const merged: MessageParam[] = [messages[0]];

  for (let index = 1; index < messages.length; index++) {
    const previous = merged[merged.length - 1];
    const current = messages[index];

    if (previous.role === current.role && typeof previous.content === "string" && typeof current.content === "string") {
      merged[merged.length - 1] = {
        role: previous.role,
        content: `${previous.content}\n${current.content}`,
      };
    } else {
      merged.push(current);
    }
  }

  return merged;
}

function keepMinRespondedTurns(
  rows: { role: string; content: string }[],
  minTurns: number,
): { role: string; content: string }[] {
  let assistantCount = 0;
  let cutoff = 0;

  for (let index = rows.length - 1; index >= 0; index--) {
    if (rows[index].role === "assistant") {
      assistantCount++;
    }
    if (assistantCount >= minTurns) {
      cutoff = index;
      break;
    }
  }

  if (assistantCount < minTurns) return rows;
  return rows.slice(cutoff);
}
