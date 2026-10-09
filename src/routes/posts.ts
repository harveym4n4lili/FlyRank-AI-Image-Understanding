import { Router } from "express";
import { z } from "zod";
import { workspaceOf } from "../http/auth.js";
import type { MatchingService } from "../services/matching.js";
import type { PostsService } from "../services/posts.js";

const CreatePost = z
  .object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase words separated by hyphens").max(120),
    title: z.string().trim().min(3).max(200),
    body: z.string().trim().min(20).max(20_000),
  })
  .strict();

const PostParams = z.object({ id: z.uuid() });
const CheckParams = z.object({ id: z.uuid(), imageId: z.uuid() });
const MatchQuery = z.object({ limit: z.coerce.number().int().min(1).max(20).default(5) }).strict();
const ListQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).strict();

export function postsRouter(posts: PostsService, matching: MatchingService) {
  const router = Router();

  router.post("/posts", async (req, res) => {
    const input = CreatePost.parse(req.body);
    const { post, created } = await posts.create(workspaceOf(res), input);
    res.status(created ? 201 : 200).json(post);
  });

  router.get("/posts", async (req, res) => {
    const { limit } = ListQuery.parse(req.query);
    const items = await posts.list(workspaceOf(res), limit);
    res.json({ count: items.length, items });
  });

  router.get("/posts/:id", async (req, res) => {
    const { id } = PostParams.parse(req.params);
    res.json(await posts.get(workspaceOf(res), id));
  });

  router.get("/posts/:id/images", async (req, res) => {
    const { id } = PostParams.parse(req.params);
    const { limit } = MatchQuery.parse(req.query);
    res.json(await matching.matchForPost(workspaceOf(res), id, limit));
  });

  router.post("/posts/:id/images/:imageId/check", async (req, res) => {
    const { id, imageId } = CheckParams.parse(req.params);
    res.json(await matching.checkCandidate(workspaceOf(res), id, imageId));
  });

  return router;
}
