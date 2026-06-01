import { requireEnv } from "@/requireEnv.ts";
import { fetchWithRetry } from "@/retry/fetchWithRetry.ts";
import { EMBEDDING_DIMS, EMBEDDING_MODEL } from "@/embeddings/embeddingModel.ts";

const ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`;

// The two sides of asymmetric retrieval embedding. The literal values are deliberately
// self-documenting: pass "search-query" when embedding something a user is searching FOR,
// and "stored-document" when embedding text being saved to search against later. Mixing
// them up silently degrades recall (no error), so the names carry the meaning.
export type EmbedMode = "search-query" | "stored-document";

// Embed a single text. gemini-embedding-001 takes one input per call; callers that
// need many should loop.
export async function embedText(text: string, mode: EmbedMode): Promise<number[]> {
  const apiKey = requireEnv("GEMINI_API_KEY");
  const taskType = mode === "search-query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";

  const response = await fetchWithRetry(ENDPOINT, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: EMBEDDING_DIMS,
    }),
  }, { timeoutMs: 30_000 });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini embedding failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  const values = data.embedding?.values as number[] | undefined;
  if (!values || values.length === 0) {
    throw new Error("Gemini embedding returned no values");
  }
  if (values.length !== EMBEDDING_DIMS) {
    // Guard the vector(1536) columns: a wrong-length vector would fail the INSERT
    // outside safeEmbed's catch. Throwing here routes it through safeEmbed → null.
    throw new Error(`Gemini embedding returned ${values.length} dims, expected ${EMBEDDING_DIMS}`);
  }

  // outputDimensionality < 3072 is not auto-normalized by the model; normalize here
  // so cosine distance is well-behaved and robust to a future change of distance op.
  return normalize(values);
}

function normalize(vector: number[]): number[] {
  let sumSquares = 0;
  for (const value of vector) sumSquares += value * value;
  const magnitude = Math.sqrt(sumSquares);
  if (magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
}
