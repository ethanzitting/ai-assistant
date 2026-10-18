import { createFireworks } from "@ai-sdk/fireworks";
import { createXai } from "@ai-sdk/xai";
import { requireEnv } from "@/requireEnv.ts";

const FIREWORKS_BASE_URL = "https://us.api.fireworks.ai/inference/v1";
const PRIMARY_MODEL_ID = "grok-4.7";
const FIREWORKS_MODEL_IDS = {
  vision: "accounts/fireworks/models/glm-5p3-flash",
  consolidation: "accounts/fireworks/models/gpt-oss-120b",
  filename: "accounts/fireworks/models/nemotron-lightning-3p5-30b-a3b",
} as const;

let fireworksProvider: ReturnType<typeof createFireworks> | null = null;
let xaiProvider: ReturnType<typeof createXai> | null = null;

export type ModelRole = "primary" | keyof typeof FIREWORKS_MODEL_IDS;
export const VISION_MODEL_TAG = FIREWORKS_MODEL_IDS.vision;

export function getModel(role: ModelRole) {
  if (role === "primary") return getXaiProvider()(PRIMARY_MODEL_ID);
  return getFireworksProvider()(FIREWORKS_MODEL_IDS[role]);
}

function getFireworksProvider(): ReturnType<typeof createFireworks> {
  if (!fireworksProvider) {
    fireworksProvider = createFireworks({
      apiKey: requireEnv("FIREWORKS_API_KEY"),
      baseURL: FIREWORKS_BASE_URL,
      headers: { "x-session-affinity": "jarvis" },
    });
  }
  return fireworksProvider;
}

function getXaiProvider(): ReturnType<typeof createXai> {
  if (!xaiProvider) {
    xaiProvider = createXai({
      apiKey: requireEnv("XAI_API_KEY"),
    });
  }
  return xaiProvider;
}
