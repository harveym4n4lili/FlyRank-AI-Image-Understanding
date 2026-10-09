import express from "express";
import { requireApiKey } from "./http/auth.js";
import { errorHandler, notFound } from "./http/errors.js";
import { costsRouter } from "./routes/costs.js";
import { healthRouter } from "./routes/health.js";
import { imagesRouter } from "./routes/images.js";
import { jobsRouter } from "./routes/jobs.js";
import { postsRouter } from "./routes/posts.js";
import type { IngestionService } from "./services/ingestion.js";
import type { MatchingService } from "./services/matching.js";
import type { PostsService } from "./services/posts.js";
import type { QueryService } from "./services/queries.js";

export interface AppDeps {
  checkDb: () => Promise<boolean>;
  resolveWorkspace: (apiKeyHash: string) => Promise<string | null>;
  ingestion: IngestionService;
  queries: QueryService;
  posts: PostsService;
  matching: MatchingService;
}

// Builds the Express app from injected dependencies so tests can run it without a database.
export function createApp(deps: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.use(healthRouter(deps.checkDb));

  app.use(requireApiKey(deps.resolveWorkspace));
  app.use(jobsRouter(deps.ingestion, deps.posts));
  app.use(postsRouter(deps.posts, deps.matching));
  app.use(imagesRouter(deps.queries));
  app.use(costsRouter(deps.queries));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
