import type { ModelResult } from "@/ai/generateModelResponse.ts";
import { executeTool } from "@/tools/toolRegistry.ts";
import { debug, info } from "@/logger.ts";
import { trace } from "@/trace.ts";

export interface ToolCallResult {
  toolUseId: string;
  toolName: string;
  content: string;
  isError: boolean;
}

export async function executeAllToolCalls(
  response: ModelResult,
  traceId: string,
  telegramChatId?: number | null,
): Promise<ToolCallResult[]> {
  const results: ToolCallResult[] = [];

  for (const call of response.toolCalls) {
    const input = call.input as Record<string, unknown>;
    info("tool", call.toolName, { input });
    await trace(traceId, "tool.called", {
      name: call.toolName,
      input,
    });

    const result = await executeTool(
      call.toolName,
      input,
      traceId,
      telegramChatId,
    );

    debug("tool", "Result", {
      name: call.toolName,
      content: result.content.substring(0, 200),
    });
    await trace(traceId, "tool.result", {
      name: call.toolName,
      isError: result.isError ?? false,
      contentLength: result.content.length,
      content: result.content,
    });

    results.push({
      toolUseId: call.toolCallId,
      toolName: call.toolName,
      content: result.content,
      isError: result.isError ?? false,
    });
  }

  return results;
}
