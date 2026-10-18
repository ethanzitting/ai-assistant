import { db } from "@/db.ts";
import { matchReceipt } from "@/finance/matchReceipt.ts";

interface WalmartOrder {
  order_id: string;
  order_date: string;
  grand_total: number;
  subtotal: number | null;
  tax: number | null;
  source_url: string;
  [key: string]: unknown;
}

interface WalmartItem {
  name: string;
  quantity: number | null;
  unit_price: number | null;
  item_price: number | null;
  line_price: number | null;
  [key: string]: unknown;
}

interface WalmartHistory {
  source: "walmart";
  orders: { order: WalmartOrder; items: WalmartItem[] }[];
}

const input = JSON.parse(
  await new Response(Deno.stdin.readable).text(),
) as WalmartHistory;
validateInput(input);

let itemCount = 0;
let matched = 0;
for (const entry of input.orders) {
  const receiptId = await storeOrder(entry.order, entry.items);
  const match = await matchReceipt(receiptId);
  if (match.transactionId) matched++;
  itemCount += entry.items.length;
}

const [{ unmatched, awaiting, confirmed }] = await db`
  SELECT count(*) FILTER (WHERE status = 'unmatched')::int AS unmatched,
    count(*) FILTER (WHERE status = 'awaiting_confirmation')::int AS awaiting,
    count(*) FILTER (WHERE status = 'confirmed')::int AS confirmed
  FROM transaction_receipts
  WHERE source = 'walmart'
` as unknown as [{ unmatched: number; awaiting: number; confirmed: number }];

console.log(JSON.stringify({
  source: input.source,
  orders: input.orders.length,
  items: itemCount,
  newlyMatched: matched,
  unmatched,
  awaitingConfirmation: awaiting,
  confirmed,
}));
await db.end();

async function storeOrder(
  order: WalmartOrder,
  items: WalmartItem[],
): Promise<string> {
  const purchaseDate = order.order_date.slice(0, 10);
  return await db.begin(async (tx) => {
    const [receipt] = await tx`
      INSERT INTO transaction_receipts (
        source, source_receipt_id, source_url, merchant_name, receipt_total,
        purchase_date, subtotal, tax, raw_data
      ) VALUES (
        'walmart', ${order.order_id}, ${order.source_url}, 'Walmart',
        ${order.grand_total}, ${purchaseDate}::date, ${order.subtotal}, ${order.tax},
        ${tx.json(order as never)}
      )
      ON CONFLICT (source, source_receipt_id) WHERE source_receipt_id IS NOT NULL
      DO UPDATE SET
        source_url = EXCLUDED.source_url,
        merchant_name = EXCLUDED.merchant_name,
        receipt_total = EXCLUDED.receipt_total,
        purchase_date = EXCLUDED.purchase_date,
        subtotal = EXCLUDED.subtotal,
        tax = EXCLUDED.tax,
        raw_data = EXCLUDED.raw_data,
        transaction_id = CASE
          WHEN transaction_receipts.receipt_total IS DISTINCT FROM EXCLUDED.receipt_total
            OR transaction_receipts.purchase_date IS DISTINCT FROM EXCLUDED.purchase_date
          THEN NULL ELSE transaction_receipts.transaction_id END,
        status = CASE
          WHEN transaction_receipts.receipt_total IS DISTINCT FROM EXCLUDED.receipt_total
            OR transaction_receipts.purchase_date IS DISTINCT FROM EXCLUDED.purchase_date
          THEN 'unmatched' ELSE transaction_receipts.status END,
        matched_at = CASE
          WHEN transaction_receipts.receipt_total IS DISTINCT FROM EXCLUDED.receipt_total
            OR transaction_receipts.purchase_date IS DISTINCT FROM EXCLUDED.purchase_date
          THEN NULL ELSE transaction_receipts.matched_at END,
        confirmed_at = CASE
          WHEN transaction_receipts.receipt_total IS DISTINCT FROM EXCLUDED.receipt_total
            OR transaction_receipts.purchase_date IS DISTINCT FROM EXCLUDED.purchase_date
          THEN NULL ELSE transaction_receipts.confirmed_at END
      RETURNING id
    ` as unknown as [{ id: string }];

    await tx`DELETE FROM transaction_receipt_items WHERE receipt_id = ${receipt.id}`;
    for (const [lineIndex, item] of items.entries()) {
      await tx`
        INSERT INTO transaction_receipt_items (
          receipt_id, line_index, name, quantity, unit_price, line_total, metadata
        ) VALUES (
          ${receipt.id}, ${lineIndex}, ${item.name}, ${item.quantity},
          ${item.unit_price ?? item.item_price}, ${item.line_price},
          ${tx.json(item as never)}
        )
      `;
    }
    return receipt.id;
  });
}

function validateInput(input: WalmartHistory): void {
  if (input.source !== "walmart" || !Array.isArray(input.orders)) {
    throw new Error("Input must be a Walmart history bundle.");
  }

  const ids = new Set<string>();
  for (const entry of input.orders) {
    const order = entry.order;
    if (!order?.order_id || ids.has(order.order_id)) {
      throw new Error(
        `Missing or duplicate Walmart order id: ${order?.order_id}`,
      );
    }
    if (!Number.isFinite(order.grand_total) || order.grand_total <= 0) {
      throw new Error(`Invalid total for Walmart order ${order.order_id}.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}/.test(order.order_date)) {
      throw new Error(`Invalid date for Walmart order ${order.order_id}.`);
    }
    if (!Array.isArray(entry.items) || entry.items.some((item) => !item.name)) {
      throw new Error(`Invalid items for Walmart order ${order.order_id}.`);
    }
    ids.add(order.order_id);
  }
}
