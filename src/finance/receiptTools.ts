import * as v from "valibot";
import { db } from "@/db.ts";
import { matchReceipt } from "@/finance/matchReceipt.ts";
import { requirePrivateChat } from "@/finance/requirePrivateChat.ts";
import { parseToolInput } from "@/tools/parseToolInput.ts";
import type { ToolDefinition, ToolResult } from "@/tools/toolTypes.ts";
import { trace } from "@/trace.ts";

const receiptSchema = v.object({
  archived_file_id: v.pipe(v.string(), v.uuid()),
  receipt_total: v.pipe(v.number(), v.minValue(0.01)),
  merchant_name: v.optional(v.pipe(v.string(), v.minLength(1))),
  purchase_date: v.optional(v.string()),
});

const receiptIdSchema = v.object({ receipt_id: v.pipe(v.string(), v.uuid()) });

const receiptListSchema = v.object({
  status: v.optional(
    v.picklist(["awaiting_confirmation", "confirmed"]),
    "awaiting_confirmation",
  ),
  source: v.optional(v.pipe(v.string(), v.minLength(1))),
  uncategorized_only: v.optional(v.boolean(), false),
  limit: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(25)),
    10,
  ),
});

const receiptContentSchema = v.union([
  receiptIdSchema,
  v.object({
    receipt_ids: v.pipe(
      v.array(v.pipe(v.string(), v.uuid())),
      v.minLength(1),
      v.maxLength(10),
    ),
  }),
]);

export const recordReceiptTool: ToolDefinition = {
  schema: {
    name: "record_receipt",
    description:
      "Store a receipt photo that the user sent. Use only when the photo text or image description shows a receipt with a readable total. This stores the receipt and finds one exact Plaid charge when available. It never confirms a match or changes a category.",
    inputSchema: {
      type: "object" as const,
      properties: {
        archived_file_id: { type: "string" },
        receipt_total: { type: "number" },
        merchant_name: { type: "string" },
        purchase_date: {
          type: "string",
          description: "YYYY-MM-DD when readable.",
        },
      },
      required: ["archived_file_id", "receipt_total"],
    },
  },
  handle: recordReceipt,
};

export const listReceiptMatchesTool: ToolDefinition = {
  schema: {
    name: "list_receipt_matches",
    description:
      "List receipt-to-charge matches. Defaults to matches awaiting confirmation. To categorize imported receipts, request status=confirmed, source=walmart, and uncategorized_only=true. The result includes receipt IDs, transaction IDs, total, shown, and truncated. Do not use search_archives for imported retailer line items.",
    inputSchema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["awaiting_confirmation", "confirmed"],
        },
        source: { type: "string" },
        uncategorized_only: { type: "boolean" },
        limit: {
          type: "number",
          description: "Return 1 to 25 matches. Defaults to 10.",
        },
      },
    },
  },
  handle: listReceiptMatches,
};

export const confirmReceiptMatchTool: ToolDefinition = {
  schema: {
    name: "confirm_receipt_match",
    description:
      "Confirm one receipt-to-charge match after the user explicitly says yes, confirm, or equivalent. Never call this from the receipt image alone.",
    inputSchema: {
      type: "object" as const,
      properties: { receipt_id: { type: "string" } },
      required: ["receipt_id"],
    },
  },
  handle: confirmReceiptMatch,
};

export const getReceiptContentTool: ToolDefinition = {
  schema: {
    name: "get_receipt_content",
    description:
      "Get the line items or OCR for one to ten stored receipts. Provide receipt_id or receipt_ids, but not both. Use receipt_ids to read a small confirmed batch before you propose categories or splits. Imported retailer items live here, not in search_archives.",
    inputSchema: {
      type: "object" as const,
      properties: {
        receipt_id: {
          type: "string",
          description: "One receipt ID. Use receipt_ids for a batch.",
        },
        receipt_ids: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 10,
        },
      },
    },
  },
  handle: getReceiptContent,
};

async function recordReceipt(
  input: Record<string, unknown>,
  traceId: string,
  telegramChatId?: number | null,
): Promise<ToolResult> {
  const refusal = requirePrivateChat(telegramChatId);
  if (refusal) return refusal;
  const parsed = parseToolInput(
    receiptSchema,
    input,
    '{ archived_file_id: "uuid", receipt_total: 42.50, merchant_name?: "Store", purchase_date?: "2026-09-08" }',
  );
  if (!parsed.success) return parsed.error;

  const [receipt] = await db`
    INSERT INTO transaction_receipts (archived_file_id, receipt_total, merchant_name, purchase_date)
    SELECT ${parsed.data.archived_file_id}, ${parsed.data.receipt_total},
      ${parsed.data.merchant_name ?? null}, ${
    parsed.data.purchase_date ?? null
  }::date
    WHERE EXISTS (SELECT 1 FROM archived_files WHERE id = ${parsed.data.archived_file_id})
    ON CONFLICT (archived_file_id) DO UPDATE SET archived_file_id = EXCLUDED.archived_file_id
    RETURNING id
  ` as unknown as { id: string }[];
  if (!receipt) {
    return {
      content: "The receipt photo is not in the archive.",
      isError: true,
    };
  }

  const match = await matchReceipt(receipt.id);
  await trace(traceId, "finance.receipt_recorded", {
    receiptId: receipt.id,
    ...match,
  });
  return {
    content: JSON.stringify({
      operation: "record_receipt",
      changed: true,
      receipt_id: receipt.id,
      ...match,
    }),
  };
}

async function listReceiptMatches(
  input: Record<string, unknown>,
  _traceId: string,
  telegramChatId?: number | null,
): Promise<ToolResult> {
  const refusal = requirePrivateChat(telegramChatId);
  if (refusal) return refusal;
  const parsed = parseToolInput(
    receiptListSchema,
    input,
    '{ status?: "awaiting_confirmation"|"confirmed", source?: "walmart", uncategorized_only?: true, limit?: 10 }',
  );
  if (!parsed.success) return parsed.error;

  const rows = await db`
    SELECT r.id, r.merchant_name AS receipt_merchant, r.receipt_total, r.purchase_date,
      r.source, r.status, t.id AS transaction_id,
      t.merchant_name AS transaction_merchant, t.posted_date, t.category,
      t.needs_category, count(*) OVER ()::int AS total_matches
    FROM transaction_receipts r JOIN transactions t ON t.id = r.transaction_id
    WHERE r.status = ${parsed.data.status}
      AND (${
    parsed.data.source ?? null
  }::text IS NULL OR lower(r.source) = lower(${parsed.data.source ?? null}))
      AND (NOT ${parsed.data.uncategorized_only}::boolean OR t.needs_category)
    ORDER BY r.purchase_date DESC NULLS LAST, r.created_at DESC
    LIMIT ${parsed.data.limit}
  `;
  const total = rows.length === 0 ? 0 : Number(rows[0].total_matches);
  return {
    content: JSON.stringify({
      operation: "list_receipt_matches",
      changed: false,
      filters: parsed.data,
      total,
      shown: rows.length,
      truncated: total > rows.length,
      matches: rows,
    }),
  };
}

async function confirmReceiptMatch(
  input: Record<string, unknown>,
  traceId: string,
  telegramChatId?: number | null,
): Promise<ToolResult> {
  const refusal = requirePrivateChat(telegramChatId);
  if (refusal) return refusal;
  const parsed = parseToolInput(
    receiptIdSchema,
    input,
    '{ receipt_id: "uuid" }',
  );
  if (!parsed.success) return parsed.error;

  const rows = await db`
    UPDATE transaction_receipts SET status = 'confirmed', confirmed_at = now()
    WHERE id = ${parsed.data.receipt_id} AND status = 'awaiting_confirmation'
    RETURNING transaction_id
  ` as unknown as { transaction_id: string }[];
  if (rows.length === 0) {
    return {
      content: "That receipt match is not waiting for confirmation.",
      isError: true,
    };
  }

  await trace(traceId, "finance.receipt_confirmed", {
    receiptId: parsed.data.receipt_id,
  });
  return {
    content: JSON.stringify({
      operation: "confirm_receipt_match",
      changed: true,
      transaction_id: rows[0].transaction_id,
    }),
  };
}

async function getReceiptContent(
  input: Record<string, unknown>,
  _traceId: string,
  telegramChatId?: number | null,
): Promise<ToolResult> {
  const refusal = requirePrivateChat(telegramChatId);
  if (refusal) return refusal;
  const parsed = parseToolInput(
    receiptContentSchema,
    input,
    '{ receipt_id: "uuid" } or { receipt_ids: ["uuid", "uuid"] } (maximum 10)',
  );
  if (!parsed.success) return parsed.error;
  const receiptIds = "receipt_ids" in parsed.data
    ? parsed.data.receipt_ids
    : [parsed.data.receipt_id];

  const rows = await db`
    SELECT r.id, r.source, r.source_receipt_id, r.receipt_total, r.subtotal, r.tax,
      r.merchant_name, r.purchase_date, r.status, r.transaction_id, r.source_url,
      af.ocr_text, af.vision_description, t.merchant_name AS transaction_merchant,
      t.posted_date, t.amount AS transaction_amount, t.category, t.needs_category,
      COALESCE((
        SELECT json_agg(json_build_object(
          'line_index', i.line_index,
          'name', i.name,
          'quantity', i.quantity,
          'unit_price', i.unit_price,
          'line_total', i.line_total
        ) ORDER BY i.line_index)
        FROM transaction_receipt_items i
        WHERE i.receipt_id = r.id
      ), '[]'::json) AS items
    FROM transaction_receipts r
    LEFT JOIN archived_files af ON af.id = r.archived_file_id
    LEFT JOIN transactions t ON t.id = r.transaction_id
    WHERE r.id = ANY(${receiptIds}::uuid[])
    ORDER BY array_position(${receiptIds}::uuid[], r.id)
  `;
  if (rows.length === 0) return { content: "No such receipts.", isError: true };
  const foundIds = new Set(rows.map((row) => String(row.id)));
  return {
    content: JSON.stringify({
      operation: "get_receipt_content",
      changed: false,
      requested: receiptIds.length,
      found: rows.length,
      missing_receipt_ids: receiptIds.filter((id) => !foundIds.has(id)),
      receipts: rows,
    }),
  };
}
