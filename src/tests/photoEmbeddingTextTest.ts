import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { photoEmbeddingText } from "@/embeddings/embeddingText.ts";

Deno.test("photoEmbeddingText leads with the description and labels the OCR text", () => {
  assertEquals(
    photoEmbeddingText({
      visionDescription: "Bar chart of incarceration rates.",
      ocrText: "Share of men incarcerated",
    }),
    "Bar chart of incarceration rates.\n\nText in image:\nShare of men incarcerated",
  );
});

Deno.test("photoEmbeddingText omits the section it lacks", () => {
  assertEquals(
    photoEmbeddingText({ visionDescription: "Bar chart.", ocrText: null }),
    "Bar chart.",
  );
  assertEquals(
    photoEmbeddingText({ visionDescription: null, ocrText: "Some text" }),
    "Text in image:\nSome text",
  );
});

// An image the vision pass and OCR both failed on must compose to empty, because
// replaceArchivedFileChunks treats empty text as a no-op rather than deleting the chunk a
// previous run stored.
Deno.test("photoEmbeddingText is empty when both inputs are missing", () => {
  assertEquals(photoEmbeddingText({ visionDescription: null, ocrText: null }), "");
});
