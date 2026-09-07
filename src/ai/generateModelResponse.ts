import { generateText, type ModelMessage, type ToolSet } from "ai";
import { getModel } from "@/ai/models.ts";

const MAX_OUTPUT_TOKENS = 8192;

interface GenerateModelResponseOptions {
  systemPrompt: string;
  messages: ModelMessage[];
  tools: ToolSet;
}

export async function generateModelResponse(
  options: GenerateModelResponseOptions,
) {
  return await generateText({
    model: getModel("primary"),
    system: options.systemPrompt,
    messages: options.messages,
    tools: options.tools,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxRetries: 1,
  });
}

export type ModelResult = Awaited<ReturnType<typeof generateModelResponse>>;
