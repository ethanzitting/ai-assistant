import { generateText, jsonSchema, type LanguageModelUsage, tool } from "ai";
import { getModel } from "@/ai/models.ts";
import type { FactCluster } from "@/maintenance/factClusters.ts";
import {
  type ConsolidatedFact,
  validateConsolidationDecision,
} from "@/maintenance/validateConsolidationDecision.ts";

export type ConsolidationDecision = {
  consolidatedFacts: ConsolidatedFact[];
  reasoning: string;
  tokenUsage: LanguageModelUsage;
};

const CONSOLIDATION_TOOL = tool({
  description: "Submit the consolidated, de-duplicated facts for this group.",
  inputSchema: jsonSchema({
    type: "object",
    properties: {
      consolidated_facts: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        description:
          "The smallest set of canonical facts that together preserve EVERY unique detail from the input group. Usually one; more only if the group genuinely holds distinct sub-facts.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            attribute: {
              type: "string",
              minLength: 1,
              maxLength: 100,
              pattern: "^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$",
              description: "Clear snake_case attribute name.",
            },
            value: {
              type: "string",
              minLength: 1,
              maxLength: 10000,
              description:
                "Complete value retaining every specific (dates, numbers, names, doses) from all variants.",
            },
          },
          required: ["attribute", "value"],
        },
      },
      reasoning: {
        type: "string",
        minLength: 1,
        maxLength: 2000,
        description: "One or two sentences on what was merged or dropped.",
      },
    },
    required: ["consolidated_facts", "reasoning"],
    additionalProperties: false,
  }),
  outputSchema: jsonSchema({ type: "string" }),
});

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
  const factList = cluster.facts.map((fact, index) =>
    `${index + 1}. ${fact.attribute}: ${fact.value}`
  ).join("\n");
  const guidance = context.note ? `Curator guidance: ${context.note}\n` : "";

  const response = await generateText({
    model: getModel("consolidation"),
    maxOutputTokens: 4096,
    maxRetries: 1,
    reasoning: "low",
    system: SYSTEM_PROMPT,
    tools: { submit_consolidation: CONSOLIDATION_TOOL },
    toolChoice: { type: "tool", toolName: "submit_consolidation" },
    messages: [{
      role: "user",
      content:
        `Today's date is ${context.today}.\n${guidance}\nEntity: ${cluster.entityName}\n\nNear-duplicate facts:\n${factList}`,
    }],
  });

  const toolUse = response.toolCalls.find((call) =>
    call.toolName === "submit_consolidation"
  );
  if (!toolUse) {
    throw new Error(
      `Model did not return a consolidation for the ${cluster.entityName} cluster`,
    );
  }
  const input = isRecord(toolUse.input) ? toolUse.input : {};
  const decision = validateConsolidationDecision({
    consolidatedFacts: input.consolidated_facts,
    reasoning: input.reasoning,
  });
  return {
    ...decision,
    tokenUsage: response.usage,
  };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}
