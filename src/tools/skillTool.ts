import * as v from "valibot";
import { db } from "@/db.ts";
import { parseToolInput } from "@/tools/parseToolInput.ts";
import type { ToolDefinition } from "@/tools/toolTypes.ts";

const skillInputSchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.nonEmpty()),
});

export const skillTool: ToolDefinition = {
  schema: {
    name: "fetch_skill",
    description:
      "Load a skill's full instructions by name. Use when a skill is relevant to the current task.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "The skill name to load",
        },
      },
      required: ["name"],
    },
  },
  handle: async (input: Record<string, unknown>) => {
    const parsed = parseToolInput(skillInputSchema, input, '{ name: "skill_name" }');
    if (!parsed.success) return parsed.error;

    const results = await db`
      SELECT body FROM skills WHERE name = ${parsed.data.name}
    `;

    if (results.length === 0) {
      return { content: `No skill found with name "${parsed.data.name}".`, isError: true };
    }

    return { content: results[0].body as string };
  },
};
