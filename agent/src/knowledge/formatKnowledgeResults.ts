import type { EntityRecord, FactRecord, RelationshipRecord } from "@/knowledge/knowledgeQueries.ts";

export function formatKnowledgeResults(
  entities: EntityRecord[],
  facts: FactRecord[],
  relationships: RelationshipRecord[],
): string {
  const sections = entities.map((entity) =>
    formatSingleEntity(entity, facts, relationships)
  );
  return sections.join("\n\n");
}

function formatSingleEntity(
  entity: EntityRecord,
  allFacts: FactRecord[],
  allRelationships: RelationshipRecord[],
): string {
  const entityFacts = allFacts.filter((fact) => fact.entity_id === entity.id);
  const entityRelationships = allRelationships.filter(
    (rel) => rel.entity_a_id === entity.id || rel.entity_b_id === entity.id,
  );

  const lines = [`**${entity.name}** (${entity.type})`];

  for (const fact of entityFacts) {
    const historicalMarker = fact.valid_until ? " [historical]" : "";
    lines.push(`  ${fact.attribute}: ${fact.value}${historicalMarker}`);
  }

  for (const rel of entityRelationships) {
    lines.push(`  ${rel.type}: ${rel.entity_name}`);
  }

  return lines.join("\n");
}
