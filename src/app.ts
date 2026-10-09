import express from "express";
import { healthRouter } from "./routes/health.js";
import { errorHandler, notFound } from "./http/errors.js";

export interface AppDeps {
  checkDb: () => Promise<boolean>;
}

// Builds the Express app from injected dependencies so tests can run it without a database.
export function createApp(deps: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.use(healthRouter(deps.checkDb));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
