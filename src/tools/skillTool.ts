import { db } from "@/db.ts";
import type { ToolDefinition } from "@/tools/toolTypes.ts";

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
  handle: async (input) => {
    const skillName = input.name as string;

    const results = await db`
      SELECT body FROM skills WHERE name = ${skillName}
    `;

    if (results.length === 0) {
      return { content: `No skill found with name "${skillName}".`, isError: true };
    }

    return { content: results[0].body as string };
  },
};
