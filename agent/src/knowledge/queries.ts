import { db } from "@/db.ts";

export interface EntityRecord {
  id: string;
  type: string;
  name: string;
  properties: unknown;
}

export interface FactRecord {
  entity_id: string;
  attribute: string;
  value: string;
  valid_from: Date;
  valid_until: Date | null;
}

export interface RelationshipRecord {
  entity_a_id: string;
  entity_b_id: string;
  type: string;
  entity_name: string;
}

export async function searchEntities(
  searchQuery: string,
  entityType?: string,
): Promise<EntityRecord[]> {
  const searchPattern = `%${searchQuery}%`;

  if (entityType) {
    return db`
      SELECT id, type, name, properties
      FROM entities
      WHERE type = ${entityType} AND name ILIKE ${searchPattern}
      ORDER BY name LIMIT 20
    `;
  }

  return db`
    SELECT id, type, name, properties
    FROM entities
    WHERE name ILIKE ${searchPattern}
    ORDER BY name LIMIT 20
  `;
}

export async function findCurrentFacts(
  entityIds: string[],
  includeHistorical: boolean,
): Promise<FactRecord[]> {
  if (includeHistorical) {
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
