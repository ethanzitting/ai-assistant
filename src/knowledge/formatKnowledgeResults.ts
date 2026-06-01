import type { EntityRecord } from "@/knowledge/searchEntities.ts";
import type { FactRecord } from "@/knowledge/findCurrentFacts.ts";
import type { RelationshipRecord } from "@/knowledge/findRelationships.ts";

export interface KnowledgeResults {
  entities: EntityRecord[];
  facts: FactRecord[];
  relationships: RelationshipRecord[];
  // Facts that matched the query — surfaced first within each entity's fact list.
  relevantFactIds: Set<string>;
  // Max facts shown per entity before truncating. Caller decides (the cap, or effectively
  // unbounded when the query opted into include_all_facts).
  maxFactsPerEntity: number;
}

export function formatKnowledgeResults(results: KnowledgeResults): string {
  const sections = results.entities.map((entity) => formatSingleEntity(entity, results));
  return sections.join("\n\n");
}

function formatSingleEntity(entity: EntityRecord, results: KnowledgeResults): string {
  const { facts, relationships, relevantFactIds } = results;
  const entityFacts = facts.filter((fact) => fact.entity_id === entity.id);
  const entityRelationships = relationships.filter(
    (rel) => rel.entity_a_id === entity.id || rel.entity_b_id === entity.id,
  );

  // Query-relevant facts first, then the rest; cap so a heavily-attributed entity
  // doesn't dump its entire record and bury the answer.
  const relevant = entityFacts.filter((fact) => relevantFactIds.has(fact.id));
  const others = entityFacts.filter((fact) => !relevantFactIds.has(fact.id));
  const ordered = [...relevant, ...others];
  const shown = ordered.slice(0, results.maxFactsPerEntity);
  const hidden = ordered.length - shown.length;

  const lines = [`**${entity.name}** (${entity.type})`];

  for (const fact of shown) {
    const historicalMarker = fact.valid_until ? " [historical]" : "";
    lines.push(`  ${fact.attribute}: ${fact.value}${historicalMarker}`);
  }
  if (hidden > 0) {
    lines.push(
      `  …and ${hidden} more fact${hidden === 1 ? "" : "s"} not shown. Try a more specific query, ` +
        `or set include_all_facts: true to list them all.`,
    );
  }

  for (const rel of entityRelationships) {
    lines.push(`  ${rel.type}: ${rel.entity_name}`);
  }

  return lines.join("\n");
}
