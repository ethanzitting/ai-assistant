import { db } from "@/db.ts";
import { EMBEDDING_MODEL_TAG } from "@/embeddings/embeddingModel.ts";

export type ClusterFact = { id: string; attribute: string; value: string };
export type FactCluster = { entityId: string; entityName: string; facts: ClusterFact[] };

export async function findFactClusters(
  options: { entityName?: string; threshold: number },
): Promise<FactCluster[]> {
  const entityName = options.entityName ?? null;
  const edges = await db`
    SELECT fa.id AS a, fb.id AS b, fa.entity_id AS entity_id, e.name AS entity_name
    FROM facts fa
    JOIN facts fb ON fb.entity_id = fa.entity_id AND fb.id < fa.id
    JOIN entities e ON e.id = fa.entity_id
    WHERE fa.valid_until IS NULL AND fb.valid_until IS NULL
      AND fa.embedding IS NOT NULL AND fb.embedding IS NOT NULL
      AND fa.embedding_model = ${EMBEDDING_MODEL_TAG}
      AND fb.embedding_model = ${EMBEDDING_MODEL_TAG}
      AND (fa.embedding <=> fb.embedding) < ${options.threshold}
      AND (${entityName}::text IS NULL OR e.name = ${entityName}::text)
  ` as unknown as Array<{ a: string; b: string; entity_id: string; entity_name: string }>;

  if (edges.length === 0) return [];

  const factIds = new Set<string>();
  for (const edge of edges) {
    factIds.add(edge.a);
    factIds.add(edge.b);
  }
  const factRows = await db`
    SELECT id, entity_id, attribute, value FROM facts WHERE id::text = ANY(${[...factIds]})
  ` as unknown as Array<{ id: string; entity_id: string; attribute: string; value: string }>;
  const factById = new Map(factRows.map((row) => [row.id, row]));
  const entityNameById = new Map(edges.map((edge) => [edge.entity_id, edge.entity_name]));

  return connectedComponents(edges.map((edge) => [edge.a, edge.b]))
    .map((ids) => {
      const facts = ids.map((id) => factById.get(id)).filter((row): row is NonNullable<typeof row> => Boolean(row));
      return {
        entityId: facts[0].entity_id,
        entityName: entityNameById.get(facts[0].entity_id) ?? "unknown",
        facts: facts.map((row) => ({ id: row.id, attribute: row.attribute, value: row.value })),
      };
    })
    .sort((a, b) => b.facts.length - a.facts.length);
}

function connectedComponents(edges: Array<[string, string]>): string[][] {
  const parent = new Map<string, string>();
  const find = (node: string): string => {
    if (!parent.has(node)) parent.set(node, node);
    let root = node;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(node, root);
    return root;
  };
  for (const [a, b] of edges) parent.set(find(a), find(b));

  const groups = new Map<string, string[]>();
  for (const node of [...parent.keys()]) {
    const root = find(node);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(node);
  }
  return [...groups.values()];
}
