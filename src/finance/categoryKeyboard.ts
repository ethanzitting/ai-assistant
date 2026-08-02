import { InlineKeyboard } from "grammy";
import { db } from "@/db.ts";

const BUTTONS_PER_ROW = 2;

export interface CategoryOption {
  id: number;
  name: string;
}

// Telegram caps callback_data at 64 bytes, which is why both ids are integers rather than the
// transaction UUID. Prefixes: c = choose a category, m = show the full list, s = split or receipt,
// a = always use the category just chosen, k = keep asking about this merchant.
export const CALLBACK = {
  choose: (promptId: number, categoryId: number) => `c:${promptId}:${categoryId}`,
  more: (promptId: number) => `m:${promptId}`,
  split: (promptId: number) => `s:${promptId}`,
  always: (promptId: number, categoryId: number) => `a:${promptId}:${categoryId}`,
  keepAsking: (promptId: number) => `k:${promptId}`,
};

export async function loadCategoryOptions(): Promise<CategoryOption[]> {
  return await db`
    SELECT id, name FROM categories WHERE active ORDER BY sort_order
  ` as unknown as CategoryOption[];
}

// Two per row rather than three: names like "Cell Phone Connection" and "Utility: Natural Gas" are
// long enough that three columns truncate them into ambiguity — and "Utility: Natural Gas" next to
// "Car Fuel" is exactly the pair that must never be confused.
export function categoryKeyboard(
  promptId: number,
  options: CategoryOption[],
  suggested: string[],
): InlineKeyboard {
  const byName = new Map(options.map((option) => [option.name, option]));
  const keyboard = new InlineKeyboard();

  const shown = suggested
    .map((name) => byName.get(name))
    .filter((option): option is CategoryOption => option !== undefined);

  addRows(keyboard, promptId, shown);
  keyboard.row()
    .text("More…", CALLBACK.more(promptId))
    .text("Split / receipt", CALLBACK.split(promptId));

  return keyboard;
}

export function fullCategoryKeyboard(
  promptId: number,
  options: CategoryOption[],
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  addRows(keyboard, promptId, options);
  keyboard.row().text("Split / receipt", CALLBACK.split(promptId));
  return keyboard;
}

// Offered after an answer, so a merchant graduates from unknown to a standing rule without a
// separate conversation.
export function followUpKeyboard(promptId: number, categoryId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("Always this category", CALLBACK.always(promptId, categoryId))
    .text("Keep asking", CALLBACK.keepAsking(promptId));
}

function addRows(keyboard: InlineKeyboard, promptId: number, options: CategoryOption[]): void {
  options.forEach((option, index) => {
    if (index > 0 && index % BUTTONS_PER_ROW === 0) keyboard.row();
    keyboard.text(option.name, CALLBACK.choose(promptId, option.id));
  });
}
