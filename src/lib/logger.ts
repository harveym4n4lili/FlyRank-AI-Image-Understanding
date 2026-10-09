import { pino } from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "*.apiKey",
      "*.api_key",
      "*.key",
      "*.password",
      "req.headers.authorization",
      'req.headers["x-api-key"]',
      "GEMINI_API_KEY",
    ],
    censor: "[redacted]",
  },
});
