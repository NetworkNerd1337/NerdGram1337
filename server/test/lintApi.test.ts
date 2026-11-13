import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { makeTempDataDir } from "./helpers.js";

const HOST = "127.0.0.1:8787";

describe("lint API", () => {
  let cleanup = async () => {};

  beforeEach(async () => {
    cleanup = (await makeTempDataDir()).cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("lints one diagram and lists workspace warnings", async () => {
    const app = createApp({ mode: "production", port: 8787, bindHosts: ["127.0.0.1", "::1"] });
    const source = "flowchart LR\n  A[One] --> Ennd\n  classDef muted fill:#eee\n";
    const created = await request(app)
      .put("/api/file")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ path: "Broken.mmd", content: source });
    expect(created.status).toBe(200);

    const one = await request(app)
      .post("/api/lint")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({
        source,
        diagramPaths: ["Broken.mmd"],
        rules: { "unused-class": false },
      });
    expect(one.status).toBe(200);
    expect(one.body.diagnostics.some((item: { ruleId: string }) => item.ruleId === "unlabeled-endpoint")).toBe(true);
    expect(one.body.diagnostics.some((item: { ruleId: string }) => item.ruleId === "unused-class")).toBe(false);

    const clean = await request(app)
      .post("/api/lint")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ source: "flowchart LR\n  A[One] --> B[Two]\n" });
    expect(clean.status).toBe(200);
    expect(clean.body.diagnostics).toEqual([]);

    const workspace = await request(app).get("/api/diagram-lint").set("Host", HOST);
    expect(workspace.status).toBe(200);
    expect(workspace.body.checked).toBeGreaterThan(0);
    const broken = workspace.body.diagrams.find((item: { path: string }) => item.path === "Broken.mmd");
    expect(broken.diagnostics.some((item: { ruleId: string }) => item.ruleId === "unused-class")).toBe(true);

    const rejected = await request(app)
      .post("/api/lint")
      .set("Host", HOST)
      .set("Content-Type", "application/json")
      .send({ source: 12 });
    expect(rejected.status).toBe(400);
  });
});
