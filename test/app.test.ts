import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("app skeleton", () => {
  it("reports ok when the database is reachable", async () => {
    const res = await request(createApp({ checkDb: async () => true })).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", db: true });
  });

  it("reports 503 when the database check fails", async () => {
    const app = createApp({ checkDb: async () => { throw new Error("down"); } });
    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.db).toBe(false);
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const res = await request(createApp({ checkDb: async () => true })).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 400, not 500, for malformed JSON", async () => {
    const res = await request(createApp({ checkDb: async () => true }))
      .post("/health")
      .set("Content-Type", "application/json")
      .send("{bad json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });
});
