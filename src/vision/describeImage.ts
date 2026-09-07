import { generateText } from "ai";
import { getModel } from "@/ai/models.ts";
import type { SupportedMediaType } from "@/vision/isSupportedMediaType.ts";
import { warn } from "@/logger.ts";

const MAX_DESCRIPTION_TOKENS = 700;

const DESCRIPTION_PROMPT =
  `You are writing the searchable index entry for an image in a personal reference library. \
Your description is the ONLY representation of this image that can be searched — it will be \
embedded and matched months later against natural-language questions like "that chart about \
prison rates and family income".

If the image is a chart or graph, state: the chart type; what each axis measures and its units; \
the series or categories plotted; the overall trend or headline finding; the two to four most \
important figures; and any visible source or publisher.

Only state a number you can actually read. If a value is unlabeled, say it is unlabeled rather \
than estimating it from the plot. Do not guess at a source that is not shown.

Include the subject-matter vocabulary someone would search with even when those words do not \
appear in the image — for a chart on prison populations, words like incarceration, prison, and \
criminal justice.

If the image is not a chart, say what it is in one line, then describe its content in the same \
compact form.

Reply with plain prose only. No markdown headings, no bullet points, and no preamble such as \
"This image shows". Aim for 400 to 800 characters.`;

export async function describeImage(
  imageBytes: ArrayBuffer,
  mediaType: SupportedMediaType,
): Promise<string | null> {
  try {
    const response = await generateText({
      model: getModel("vision"),
      maxOutputTokens: MAX_DESCRIPTION_TOKENS,
      maxRetries: 1,
      system: DESCRIPTION_PROMPT,
      messages: [{
        role: "user",
        content: [
          { type: "file", data: imageBytes, mediaType },
          { type: "text", text: "Describe this image for search." },
        ],
      }],
    });

    const text = response.text.trim();
    return text.length === 0 ? null : text;
  } catch (err: unknown) {
    warn("vision", "Image description failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
