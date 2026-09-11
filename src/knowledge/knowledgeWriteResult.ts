import type { ToolResult } from "@/tools/toolTypes.ts";

export interface KnowledgeWriteResult extends ToolResult {
  changed: boolean;
  reason: string;
}
