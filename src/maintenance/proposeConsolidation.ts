import type { Tool } from "@anthropic-ai/sdk/resources/messages.mjs";
import { getClient } from "@/anthropic/getClient.ts";
import { callWithRetry } from "@/anthropic/callWithRetry.ts";
import type { TokenUsage } from "@/anthropic/sendMessage.ts";
import type { FactCluster } from "@/maintenance/factClusters.ts";

const MODEL = "claude-opus-4-6";

export type ConsolidatedFact = { attribute: string; value: string };
export type ConsolidationDecision = {
  consolidatedFacts: ConsolidatedFact[];
  reasoning: string;
  tokenUsage: TokenUsage;
};

const CONSOLIDATION_TOOL: Tool = {
  name: "submit_consolidation",
  description: "Submit the consolidated, de-duplicated facts for this group.",
  input_schema: {
    type: "object",
    properties: {
      consolidated_facts: {
        type: "array",
        description:
          "The smallest set of canonical facts that together preserve EVERY unique detail from the input group. Usually one; more only if the group genuinely holds distinct sub-facts.",
        items: {
          type: "object",
          properties: {
            attribute: { type: "string", description: "Clear snake_case attribute name." },
            value: { type: "string", description: "Complete value retaining every specific (dates, numbers, names, doses) from all variants." },
          },
          required: ["attribute", "value"],
        },
      },
      reasoning: { type: "string", description: "One or two sentences on what was merged or dropped." },
    },
    required: ["consolidated_facts", "reasoning"],
  },
};

const SYSTEM_PROMPT =
  `You curate a personal knowledge graph. You receive a group of near-duplicate facts about one entity that accumulated through attribute-name drift — the same information re-saved under slightly different attribute names and wordings.

Merge them into the smallest set of canonical facts that loses NO information:
- If every fact states the same thing, output ONE fact: the clearest attribute name and the most complete value.
- Output more than one fact only if the group genuinely contains distinct sub-facts that must not be combined.
- Preserve every unique specific — dates, numbers, names, medications, doses, caveats. A detail present in only one variant must survive.
- When variants conflict, prefer the most specific/most recent phrasing but keep any unique detail from the others.
- Resolve dates against the current date and any curator guidance given with the group — these outrank stored year values, which are often wrong (recorded before the system knew the date). For a clearly ongoing or recent event, prefer the current year even when most stored variants disagree; only treat a fact as older when it explicitly describes something from a year or more ago. Flag genuine ambiguity in your reasoning instead of inventing precision.
- Never invent information absent from the inputs.
- It's alright to split up long facts that cover multiple concepts or events.
Answer by calling submit_consolidation.`;

export async function proposeConsolidation(
  cluster: FactCluster,
  context: { today: string; note?: string },
): Promise<ConsolidationDecision> {
  const factList = cluster.facts.map((fact, index) => `${index + 1}. ${fact.attribute}: ${fact.value}`).join("\n");
  const guidance = context.note ? `Curator guidance: ${context.note}\n` : "";

  const response = await callWithRetry(() =>
    getClient().messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [CONSOLIDATION_TOOL],
      tool_choice: { type: "tool", name: "submit_consolidation" },
      messages: [{
        role: "user",
        content: `Today's date is ${context.today}.\n${guidance}\nEntity: ${cluster.entityName}\n\nNear-duplicate facts:\n${factList}`,
      }],
    })
  );

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(`Model did not return a consolidation for the ${cluster.entityName} cluster`);
  }
  const input = toolUse.input as { consolidated_facts: ConsolidatedFact[]; reasoning: string };
  const usage = response.usage as unknown as Record<string, number>;
  return {
    consolidatedFacts: input.consolidated_facts,
    reasoning: input.reasoning,
    tokenUsage: {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    },
  };
}
