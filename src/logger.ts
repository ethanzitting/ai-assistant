type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function parseLogLevel(raw: string | undefined): LogLevel {
  if (raw && raw in LEVEL_ORDER) return raw as LogLevel;
  return "info";
}

const currentLevel = parseLogLevel(Deno.env.get("LOG_LEVEL"));

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function formatData(data?: Record<string, unknown>): string {
  if (!data) return "";
  return " " + JSON.stringify(data);
}

export function debug(tag: string, message: string, data?: Record<string, unknown>): void {
  if (!shouldLog("debug")) return;
  console.debug(`[${tag}] ${message}${formatData(data)}`);
}

export function info(tag: string, message: string, data?: Record<string, unknown>): void {
  if (!shouldLog("info")) return;
  console.log(`[${tag}] ${message}${formatData(data)}`);
}

export function warn(tag: string, message: string, data?: Record<string, unknown>): void {
  if (!shouldLog("warn")) return;
  console.warn(`[${tag}] ${message}${formatData(data)}`);
}

export function error(tag: string, message: string, data?: Record<string, unknown>): void {
  console.error(`[${tag}] ${message}${formatData(data)}`);
}
