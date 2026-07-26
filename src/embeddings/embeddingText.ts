// Compose the text we embed for graph rows. Shared by the write path and backfill so
// the stored vectors never drift. Facts include the entity name so a query like
// "Dana's medications" matches the fact text "Dana Whitfield — medication: Keppra".

const MAX_PROPERTIES = 50;
const MAX_TEXT_LENGTH = 4000;

export function entityEmbeddingText(
  name: string,
  type: string,
  properties?: Record<string, unknown> | null,
): string {
  const base = `${name} (${type})`;

  // Defensive: only enumerate a genuine plain object. Legacy corrupt rows stored properties
  // as a huge string; Object.entries on that yields millions of indices and throws
  // "Too many properties to enumerate". The typeof guard skips non-objects, the cap bounds
  // pathological-but-valid objects, and the try/catch is a last resort so a bad row degrades
  // to name+type rather than crashing the whole embed.
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return base;
  try {
    const entries = Object.entries(properties).slice(0, MAX_PROPERTIES);
    if (entries.length === 0) return base;
    const formatted = entries
      .map(([key, value]) => `${key}: ${stringifyValue(value)}`)
      .join("; ");
    return `${base} — ${formatted}`.slice(0, MAX_TEXT_LENGTH);
  } catch {
    return base;
  }
}

// A plotted chart survives OCR as little more than its title — Mistral renders the plot area as
// an ![img-0.jpeg] placeholder — so the vision description carries the retrievable content and
// leads. OCR text follows because it is the literal ground truth for anything the chart spells
// out, and keeping it labelled separates what was read off the image from what a model inferred.
export interface PhotoEmbeddingTextArgs {
  visionDescription: string | null;
  ocrText: string | null;
}

export function photoEmbeddingText(args: PhotoEmbeddingTextArgs): string {
  const sections: string[] = [];
  if (args.visionDescription) sections.push(args.visionDescription);
  if (args.ocrText) sections.push(`Text in image:\n${args.ocrText}`);
  return sections.join("\n\n");
}

export function factEmbeddingText(
  entityName: string,
  attribute: string,
  value: string,
): string {
  return `${entityName} — ${attribute}: ${value}`;
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
