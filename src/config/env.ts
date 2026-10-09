import { existsSync } from "node:fs";
import { z } from "zod";

// Gemini settings are optional here so the stack boots without a key;
// the provider checks for the key when it makes its first call (Phase 2).
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z.url(),

  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_VISION_MODEL: z.string().min(1).optional(),
  GEMINI_EMBED_MODEL: z.string().min(1).optional(),

  GEMINI_MAX_RPM: z.coerce.number().int().positive().default(8),
  GEMINI_EMBED_MAX_RPM: z.coerce.number().int().positive().default(30),

  AI_BUDGET_USD: z.coerce.number().nonnegative().default(1),
  AI_MAX_CALLS_PER_DAY: z.coerce.number().int().positive().default(500),
  ALERT_WEBHOOK_URL: z.url().optional(),

  // Root folder for image ingestion; request paths must stay inside it.
  DATA_DIR: z.string().min(1).default("data"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) return cached;
  if (existsSync(".env")) process.loadEnvFile(".env");

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Report only the variable names, never their values.
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  cached = parsed.data;
  return cached;
}
