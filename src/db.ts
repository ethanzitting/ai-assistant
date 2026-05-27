import postgres from "postgres";

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const db = postgres({
  host: getRequiredEnv("DB_HOST"),
  port: parseInt(Deno.env.get("DB_PORT") || "5432"),
  user: getRequiredEnv("DB_USER"),
  password: getRequiredEnv("DB_PASSWORD"),
  database: getRequiredEnv("DB_NAME"),
});
