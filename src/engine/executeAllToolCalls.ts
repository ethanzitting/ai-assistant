import type { Message } from "@anthropic-ai/sdk/resources/messages.mjs";
import { executeTool } from "@/tools/toolRegistry.ts";
import { getToolUseBlocks } from "@/engine/parseResponse.ts";
import { info, debug } from "@/logger.ts";
import { trace } from "@/trace.ts";

export interface ToolCallResult {
  toolUseId: string;
  content: string;
  isError: boolean;
}

export async function executeAllToolCalls(
  response: Message,
  traceId: string,
  telegramChatId?: number | null,
): Promise<ToolCallResult[]> {
  const toolBlocks = getToolUseBlocks(response);
  const results: ToolCallResult[] = [];

  for (const block of toolBlocks) {
    info("tool", block.name, { input: block.input as Record<string, unknown> });
    await trace(traceId, "tool.called", { name: block.name, input: block.input });

    const result = await executeTool(
      block.name,
      block.input as Record<string, unknown>,
      traceId,
      telegramChatId,
    );

    debug("tool", "Result", { name: block.name, content: result.content.substring(0, 200) });
    await trace(traceId, "tool.result", {
      name: block.name,
      isError: result.isError ?? false,
      contentLength: result.content.length,
      content: result.content,
    });

    results.push({
      toolUseId: block.id,
      content: result.content,
      isError: result.isError ?? false,
    });
  }

  return results;
}
