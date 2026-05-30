import { db } from "@/db.ts";
import { findExistingEntity } from "@/knowledge/findExistingEntity.ts";
import type { EntityInput } from "@/knowledge/rememberSchema.ts";
import type { ToolResult } from "@/tools/toolTypes.ts";
import { trace } from "@/trace.ts";

export async function storeEntity(
  input: EntityInput,
  traceId: string,
): Promise<ToolResult> {
  const { name, type: entityType, properties } = input;

  const existing = await findExistingEntity(name);
  if (existing.length > 1) {
    const candidates = existing.map((ent) => `  - ${ent.name} (${ent.type}, id: ${ent.id})`);
    return { content: `Multiple possible matches:\n${candidates.join("\n")}\nPlease specify which entity you mean, or confirm this is a new entity.` };
  }

  if (existing.length === 1) {
    return mergeProperties(existing[0].id, existing[0].name, properties ?? {}, traceId);
  }

  const result = await db`
    INSERT INTO entities (type, name, properties)
    VALUES (${entityType}, ${name}, ${JSON.stringify(properties ?? {})})
    RETURNING id
  `;
  await trace(traceId, "db.insert", { table: "entities", id: result[0].id, name, type: entityType });
  return { content: `Created entity "${name}" (${entityType}, id: ${result[0].id}).` };
}

async function mergeProperties(
  entityId: string,
  entityName: string,
  incoming: Record<string, unknown>,
  traceId: string,
): Promise<ToolResult> {
  if (Object.keys(incoming).length === 0) {
    return { content: `Entity "${entityName}" already exists (id: ${entityId}). Stored and current — do not re-store.` };
  }

  const rows = await db`SELECT properties FROM entities WHERE id = ${entityId}`;
  const current = (rows[0].properties ?? {}) as Record<string, unknown>;
  const merged = { ...current, ...incoming };

  await db`UPDATE entities SET properties = ${JSON.stringify(merged)} WHERE id = ${entityId}`;
  await trace(traceId, "db.update", { table: "entities", id: entityId, mergedKeys: Object.keys(incoming) });
  return { content: `Entity "${entityName}" already exists (id: ${entityId}). Merged new properties: ${Object.keys(incoming).join(", ")}. Stored and current — do not re-store.` };
}
