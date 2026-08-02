import type { Context } from "grammy";
import { db } from "@/db.ts";
import {
  CALLBACK,
  categoryKeyboard,
  followUpKeyboard,
  fullCategoryKeyboard,
  loadCategoryOptions,
} from "@/finance/categoryKeyboard.ts";
import { loadCategorySuggestions } from "@/finance/loadCategorySuggestions.ts";
import { applyCategoryAnswer } from "@/finance/applyCategoryAnswer.ts";
import { setVendorPolicy } from "@/finance/setVendorPolicy.ts";
import { info, warn } from "@/logger.ts";

// A button press carries a user id and is no more trustworthy than a message, so it runs the same
// owner check the message handlers do. Prompts are only ever sent to the private chat, but nothing
// stops a forwarded message from producing a callback elsewhere.
export async function handleCategoryCallback(ctx: Context, isOwner: boolean): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  if (!isOwner) {
    warn("finance", "Rejected category callback from non-owner", { userId: ctx.from?.id });
    await ctx.answerCallbackQuery({ text: "Not available." });
    return;
  }

  const [kind, promptIdRaw, categoryIdRaw] = data.split(":");
  const promptId = Number(promptIdRaw);
  const categoryId = Number(categoryIdRaw);
  if (!Number.isFinite(promptId)) return;

  if (kind === "c") return await chooseCategory(ctx, promptId, categoryId);
  if (kind === "m") return await showFullList(ctx, promptId);
  if (kind === "s") return await offerSplit(ctx);
  if (kind === "a") return await alwaysUse(ctx, promptId, categoryId);
  if (kind === "k") return await keepAsking(ctx, promptId);
}

async function chooseCategory(ctx: Context, promptId: number, categoryId: number): Promise<void> {
  const answer = await applyCategoryAnswer(promptId, categoryId);
  if (!answer) {
    await ctx.answerCallbackQuery({ text: "That prompt is no longer active." });
    return;
  }

  info("finance", "Category answered", { category: answer.category });
  await ctx.answerCallbackQuery({ text: answer.category });

  const original = ctx.callbackQuery?.message?.text ?? "";
  await ctx.editMessageText(`${original}\n\n✓ ${answer.category}`, {
    reply_markup: answer.merchantName ? followUpKeyboard(promptId, categoryId) : undefined,
  });
}

async function showFullList(ctx: Context, promptId: number): Promise<void> {
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({
    reply_markup: fullCategoryKeyboard(promptId, await loadCategoryOptions()),
  });
}

async function offerSplit(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    "Reply with the split (for example: groceries 120, household 57.38), " +
      "or send a photo of the receipt and I'll work it out.",
  );
}

// The merchant graduates from unknown to a standing rule without a separate conversation.
async function alwaysUse(ctx: Context, promptId: number, categoryId: number): Promise<void> {
  const merchant = await merchantForPrompt(promptId);
  const category = await categoryName(categoryId);
  if (!merchant || !category) {
    await ctx.answerCallbackQuery({ text: "Couldn't set that rule." });
    return;
  }

  const result = await setVendorPolicy({
    matchType: "merchant",
    matchValue: merchant,
    policy: "auto",
    category,
  });

  await ctx.answerCallbackQuery({ text: `${merchant} → ${category}` });
  await appendNote(ctx, `Always ${category} for ${merchant} (${result.updated} past charges moved)`);
}

async function keepAsking(ctx: Context, promptId: number): Promise<void> {
  const merchant = await merchantForPrompt(promptId);
  if (!merchant) {
    await ctx.answerCallbackQuery({ text: "Couldn't set that rule." });
    return;
  }

  await setVendorPolicy({ matchType: "merchant", matchValue: merchant, policy: "ask" });
  await ctx.answerCallbackQuery({ text: `Will keep asking about ${merchant}` });
  await appendNote(ctx, `Will keep asking about ${merchant}`);
}

async function appendNote(ctx: Context, note: string): Promise<void> {
  const original = ctx.callbackQuery?.message?.text ?? "";
  await ctx.editMessageText(`${original}\n${note}`, { reply_markup: undefined });
}

async function merchantForPrompt(promptId: number): Promise<string | null> {
  const rows = await db`
    SELECT t.merchant_name FROM categorization_prompts p
    JOIN transactions t ON t.id = p.transaction_id
    WHERE p.id = ${promptId}
  ` as unknown as { merchant_name: string | null }[];
  return rows[0]?.merchant_name ?? null;
}

async function categoryName(categoryId: number): Promise<string | null> {
  const rows = await db`SELECT name FROM categories WHERE id = ${categoryId}` as unknown as {
    name: string;
  }[];
  return rows[0]?.name ?? null;
}
