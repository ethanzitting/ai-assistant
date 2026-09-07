import type { AssistantModelMessage } from "ai";
import type { ModelResult } from "@/ai/generateModelResponse.ts";

export function getAssistantMessage(
  result: ModelResult,
): AssistantModelMessage {
  const message = result.responseMessages.find((candidate) =>
    candidate.role === "assistant"
  );
  if (!message || message.role !== "assistant") {
    throw new Error("Model response did not contain an assistant message");
  }
  return message;
}
