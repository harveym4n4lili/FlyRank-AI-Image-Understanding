import { createHash } from "node:crypto";
import type { RequestHandler, Response } from "express";
import { AppError } from "../lib/errors.js";

export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

// Maps X-Api-Key to a workspace; every query downstream is scoped to res.locals.workspaceId.
export function requireApiKey(resolveWorkspace: (apiKeyHash: string) => Promise<string | null>): RequestHandler {
  return async (req, res, next) => {
    const key = req.header("x-api-key");
    if (!key) throw new AppError(401, "UNAUTHENTICATED", "Missing X-Api-Key header");
    const workspaceId = await resolveWorkspace(hashApiKey(key));
    if (!workspaceId) throw new AppError(401, "UNAUTHENTICATED", "Invalid API key");
    res.locals.workspaceId = workspaceId;
    next();
  };
}

export function workspaceOf(res: Response): string {
  return res.locals.workspaceId as string;
}
