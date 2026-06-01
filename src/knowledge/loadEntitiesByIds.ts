import { db } from "@/db.ts";
import type { EntityRecord } from "@/knowledge/searchEntities.ts";

// Load entities by id, preserving the order of the input ids (which encodes search
// relevance — fact-match entities first, then entity-vector, then keyword).
export async function loadEntitiesByIds(ids: string[]): Promise<EntityRecord[]> {
  if (ids.length === 0) return [];

  const rows = await db`
    SELECT id, type, name, properties FROM entities WHERE id = ANY(${ids})
  ` as unknown as EntityRecord[];

  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is EntityRecord => row !== undefined);
}
