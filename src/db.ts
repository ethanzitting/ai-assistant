import postgres from "postgres";
import { requireEnv } from "@/requireEnv.ts";

export const db = postgres({
  host: requireEnv("DB_HOST"),
  port: parseInt(Deno.env.get("DB_PORT") || "5432"),
  user: requireEnv("DB_USER"),
  password: requireEnv("DB_PASSWORD"),
  database: requireEnv("DB_NAME"),
  // postgres.js returns NUMERIC as a string to protect arbitrary precision. Money at two decimal
  // places is far inside what a double represents exactly, and a string would silently turn
  // `total + amount` into concatenation and `amount > 100` into a lexical comparison. Verified to
  // leave integers and REAL alone. int8 — including count(*) — is a separate case and still
  // arrives as a string, so keep casting those with ::int.
  types: {
    numeric: { to: 1700, from: [1700], serialize: String, parse: Number },
  },
});
