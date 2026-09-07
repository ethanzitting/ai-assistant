import { createFireworks } from "@ai-sdk/fireworks";
import { requireEnv } from "@/requireEnv.ts";

const FIREWORKS_BASE_URL = "https://us.api.fireworks.ai/inference/v1";
const MODEL_IDS = {
  primary: "accounts/fireworks/models/glm-5p3",
  vision: "accounts/fireworks/models/glm-5p3-flash",
  consolidation: "accounts/fireworks/models/gpt-oss-120b",
  filename: "accounts/fireworks/models/nemotron-lightning-3p5-30b-a3b",
} as const;

let provider: ReturnType<typeof createFireworks> | null = null;

export type ModelRole = keyof typeof MODEL_IDS;
export const VISION_MODEL_TAG = MODEL_IDS.vision;

export function getModel(role: ModelRole) {
  return getProvider()(MODEL_IDS[role]);
}

function getProvider(): ReturnType<typeof createFireworks> {
  if (!provider) {
    provider = createFireworks({
      apiKey: requireEnv("FIREWORKS_API_KEY"),
      baseURL: FIREWORKS_BASE_URL,
      headers: { "x-session-affinity": "jarvis" },
    });
  }
  return provider;
}
