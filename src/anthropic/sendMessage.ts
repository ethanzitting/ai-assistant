import type {
  MessageParam,
  Tool,
  Message,
} from "@anthropic-ai/sdk/resources/messages.mjs";
import { getClient } from "@/anthropic/getClient.ts";
import { callWithRetry } from "@/anthropic/callWithRetry.ts";

const MODEL = "claude-sonnet-4-20250514";
const MAX_OUTPUT_TOKENS = 4096;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface SendMessageOptions {
  systemPrompt: string;
  messages: MessageParam[];
  tools: Tool[];
}

export async function sendMessage(
  options: SendMessageOptions,
): Promise<{ response: Message; tokenUsage: TokenUsage }> {
  const response = await callWithRetry(() =>
    getClient().messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: [
        {
          type: "text",
          text: options.systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: applyCacheControl(options.tools),
      messages: options.messages,
    }),
  );

  const tokenUsage = extractTokenUsage(response);
  return { response, tokenUsage };
}

function applyCacheControl(tools: Tool[]): Tool[] | undefined {
  if (tools.length === 0) return undefined;

  return tools.map((tool, index) => {
    const isLastTool = index === tools.length - 1;
    if (!isLastTool) return tool;
    return { ...tool, cache_control: { type: "ephemeral" as const } };
  });
}

function extractTokenUsage(response: Message): TokenUsage {
  const rawUsage = response.usage as unknown as Record<string, number>;

  return {
    inputTokens: rawUsage.input_tokens,
    outputTokens: rawUsage.output_tokens,
    cacheCreationTokens: rawUsage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: rawUsage.cache_read_input_tokens ?? 0,
  };
}
