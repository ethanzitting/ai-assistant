import type { Message } from "@/anthropic/anthropicExports.ts";

export function extractTextContent(response: Message): string {
  const textParts: string[] = [];

  for (const block of response.content) {
    if (block.type === "text") {
      textParts.push(block.text);
    }
  }

  return textParts.join("");
}

export function getToolUseBlocks(
  response: Message,
): { id: string; name: string; input: Record<string, unknown> }[] {
  const toolBlocks: { id: string; name: string; input: Record<string, unknown> }[] = [];

  for (const block of response.content) {
    if (block.type === "tool_use") {
      toolBlocks.push({
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      });
    }
  }

  return toolBlocks;
}

export function hasToolUse(response: Message): boolean {
  return response.stop_reason === "tool_use";
}
