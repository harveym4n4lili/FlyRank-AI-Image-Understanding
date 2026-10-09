import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "../lib/logger.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` } });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: "VALIDATION_FAILED", message: "Request validation failed", issues: err.issues },
    });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  // Malformed JSON bodies come from express.json() as a 400 with type "entity.parse.failed".
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "INVALID_JSON", message: "Request body is not valid JSON" } });
    return;
  }

  logger.error({ err, method: req.method, path: req.path }, "unhandled error");
  res.status(500).json({ error: { code: "INTERNAL", message: "Internal server error" } });
};
