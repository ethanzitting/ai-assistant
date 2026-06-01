// Format a vector as a pgvector literal string, e.g. "[0.1,0.2,...]".
//
// FOOTGUN: this returns a STRING, not a vector. Every SQL use MUST cast it explicitly —
// `${toVectorLiteral(v)}::vector` — or Postgres rejects it (a bare string can't be stored
// in a vector column or compared with `<=>`). TypeScript can't catch a missing cast, so by
// convention the `::vector` sits directly next to every interpolation of this value.
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
