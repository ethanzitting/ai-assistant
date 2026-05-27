import { db } from "@/db.ts";

export interface RelationshipRecord {
  entity_a_id: string;
  entity_b_id: string;
  type: string;
  entity_name: string;
}

export async function findRelationships(
  entityIds: string[],
): Promise<RelationshipRecord[]> {
  return db`
    SELECT r.entity_a_id, r.entity_b_id, r.type,
           COALESCE(ea.name, eb.name) AS entity_name
    FROM relationships r
    LEFT JOIN entities ea ON r.entity_b_id = ea.id
    LEFT JOIN entities eb ON r.entity_a_id = eb.id
    WHERE (r.entity_a_id = ANY(${entityIds}) OR r.entity_b_id = ANY(${entityIds}))
      AND r.valid_until IS NULL
    ORDER BY r.type
  `;
}
