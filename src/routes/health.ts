import { Router } from "express";

export function healthRouter(checkDb: () => Promise<boolean>) {
  const router = Router();

  router.get("/health", async (_req, res) => {
    const db = await checkDb().catch(() => false);
    res.status(db ? 200 : 503).json({ status: db ? "ok" : "degraded", db });
  });

  return router;
}
