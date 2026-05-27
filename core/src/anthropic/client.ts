import Anthropic from "@anthropic-ai/sdk";

let clientInstance: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!clientInstance) {
    clientInstance = new Anthropic();
  }
  return clientInstance;
}
