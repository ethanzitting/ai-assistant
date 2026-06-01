import * as v from "valibot";
import type { ToolResult } from "@/tools/toolTypes.ts";

export function parseToolInput<T extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  schema: T,
  input: Record<string, unknown>,
  schemaHelp: string,
): { success: true; data: v.InferOutput<T> } | { success: false; error: ToolResult } {
  const result = v.safeParse(schema, input);
  if (result.success) {
    return { success: true, data: result.output };
  }

  const details = result.issues.map((issue) => {
    const path = issue.path
      ? issue.path.map((seg: v.IssuePathItem) => String(seg.key)).join(".")
      : "root";
    return `${path}: ${issue.message}`;
  });

  return {
    success: false,
    error: {
      content: `Invalid input. Expected format:\n\n${schemaHelp}\n\nErrors: ${details.join("; ")}`,
      isError: true,
    },
  };
}
