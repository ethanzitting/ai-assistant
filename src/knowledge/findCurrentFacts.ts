import { db } from "@/db.ts";

export interface FactRecord {
  entity_id: string;
  attribute: string;
  value: string;
  valid_from: Date;
  valid_until: Date | null;
}

export async function findCurrentFacts(
  entityIds: string[],
  shouldIncludeHistorical: boolean,
): Promise<FactRecord[]> {
  if (shouldIncludeHistorical) {
    return db`
      SELECT entity_id, attribute, value, valid_from, valid_until
      FROM facts
      WHERE entity_id = ANY(${entityIds})
      ORDER BY entity_id, attribute, valid_from DESC
    `;
  }

  return db`
    SELECT entity_id, attribute, value, valid_from, valid_until
    FROM facts
    WHERE entity_id = ANY(${entityIds}) AND valid_until IS NULL
    ORDER BY entity_id, attribute
  `;
}
