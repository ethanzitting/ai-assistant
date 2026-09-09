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
      "List receipt-to-charge matches that wait for the user's confirmation. Use this only when the user confirms or corrects a receipt match.",
    inputSchema: { type: "object" as const, properties: {} },
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
      receipt_id: receipt.id,
      ...match,
    }),
  };
}

async function listReceiptMatches(
  _input: Record<string, unknown>,
  _traceId: string,
  telegramChatId?: number | null,
): Promise<ToolResult> {
  const refusal = requirePrivateChat(telegramChatId);
  if (refusal) return refusal;
  const rows = await db`
    SELECT r.id, r.merchant_name AS receipt_merchant, r.receipt_total, r.purchase_date,
      t.id AS transaction_id, t.merchant_name AS transaction_merchant, t.posted_date
    FROM transaction_receipts r JOIN transactions t ON t.id = r.transaction_id
    WHERE r.status = 'awaiting_confirmation' ORDER BY r.matched_at DESC
  `;
  return {
    content: JSON.stringify({
      operation: "list_receipt_matches",
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
