import { db } from "@/db.ts";
import { safeEmbed } from "@/embeddings/safeEmbed.ts";
import { factEmbeddingText } from "@/embeddings/embeddingText.ts";
import { toVectorLiteral } from "@/embeddings/toVectorLiteral.ts";
import { EMBEDDING_MODEL_TAG } from "@/embeddings/embeddingModel.ts";
import type { FactCluster } from "@/maintenance/factClusters.ts";
import type { ConsolidationDecision } from "@/maintenance/proposeConsolidation.ts";
import { validateConsolidationDecision } from "@/maintenance/validateConsolidationDecision.ts";

export async function applyClusterConsolidation(
  cluster: FactCluster,
  decision: ConsolidationDecision,
): Promise<void> {
  const validated = validateConsolidationDecision({
    consolidatedFacts: decision.consolidatedFacts,
    reasoning: decision.reasoning,
  });
  if (cluster.facts.length === 0) {
    throw new Error("Cannot consolidate an empty source cluster");
  }

  const toInsert: Array<
    {
      attribute: string;
      value: string;
      embeddingLiteral: string | null;
      embeddingModel: string | null;
    }
  > = [];
  for (const fact of validated.consolidatedFacts) {
    const vector = await safeEmbed(
      factEmbeddingText(cluster.entityName, fact.attribute, fact.value),
      "stored-document",
    );
    toInsert.push({
      attribute: fact.attribute,
      value: fact.value,
      embeddingLiteral: vector ? toVectorLiteral(vector) : null,
      embeddingModel: vector ? EMBEDDING_MODEL_TAG : null,
    });
  }

  const originalIds = cluster.facts.map((fact) => fact.id);
  // deno-lint-ignore no-explicit-any
  await db.begin(async (tx: any) => {
    const activeFacts = await tx`
      SELECT id::text AS id, attribute, value
      FROM facts
      WHERE id::text = ANY(${originalIds}) AND valid_until IS NULL
      FOR UPDATE
    ` as Array<{ id: string; attribute: string; value: string }>;
    const activeById = new Map(activeFacts.map((fact) => [fact.id, fact]));
    const sourcesUnchanged = cluster.facts.every((source) => {
      const active = activeById.get(source.id);
      return active?.attribute === source.attribute &&
        active.value === source.value;
    });
    if (activeFacts.length !== cluster.facts.length || !sourcesUnchanged) {
      throw new Error(
        `Refusing stale consolidation for ${cluster.entityName}; source facts changed`,
      );
    }

    for (const fact of toInsert) {
      await tx`
        INSERT INTO facts (entity_id, attribute, value, embedding, embedding_model)
        VALUES (${cluster.entityId}, ${fact.attribute}, ${fact.value}, ${fact.embeddingLiteral}::vector, ${fact.embeddingModel})
      `;
    }
    const retired = await tx`
      UPDATE facts SET valid_until = now()
      WHERE id::text = ANY(${originalIds}) AND valid_until IS NULL
      RETURNING id
    `;
    if (retired.length !== originalIds.length) {
      throw new Error(
        `Refusing partial consolidation for ${cluster.entityName}`,
      );
    }
  });
}
