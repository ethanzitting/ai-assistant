import { db } from "@/db.ts";
import { EventQueue } from "@/engine/eventQueue.ts";
import { runEventLoop } from "@/engine/runEventLoop.ts";
import { createTelegramBot } from "@/telegram/createTelegramBot.ts";
import { setBotInstance } from "@/telegram/sendTelegramMessage.ts";
import { startScheduler } from "@/scheduler/startScheduler.ts";
import { info, warn, error } from "@/logger.ts";

async function healthCheck(): Promise<void> {
  const result =
    await db`SELECT now() AS time, current_database() AS database`;
  info("startup", "Connected to database", {
    database: result[0].database,
    time: String(result[0].time),
  });

  const tables = await db`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;

  if (tables.length === 0) {
    warn("startup", "No tables found — run 'make migrate' to apply migrations");
  } else {
    info("startup", "Tables loaded", {
      tables: tables.map((row) => row.table_name).join(", "),
    });
  }
}

async function main(): Promise<void> {
  info("startup", "Starting agent...");

  try {
    await healthCheck();
    info("startup", "Health check passed");
  } catch (err) {
    error("startup", "Health check failed", { error: String(err) });
    Deno.exit(1);
  }

  const queue = new EventQueue();
  const bot = createTelegramBot(queue);
  setBotInstance(bot);

  bot.start({ onStart: () => info("startup", "Telegram bot started") });

  startScheduler();

  await runEventLoop(queue);
}

main();
