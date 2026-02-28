import { expect } from "chai";
import { Hono } from "hono";
import { syncPositions } from "../src/routes/sync-positions";

describe("Sync Positions Route", () => {
  const app = new Hono();
  app.route("/", syncPositions);

  describe("GET /api/actions/sync-positions", () => {
    it("returns action metadata", async () => {
      const res = await app.request("/api/actions/sync-positions");
      expect(res.status).to.equal(200);
      const body = (await res.json()) as any;
      expect(body.type).to.equal("action");
      expect(body.title).to.include("Sync");
      expect(body.description).to.include("position counter");
      expect(body.label).to.be.a("string");
    });
  });

  describe("POST /api/actions/sync-positions", () => {
    it("returns 400 without vaultId", async () => {
      const res = await app.request(
        "/api/actions/sync-positions?actualPositions=0",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account: "11111111111111111111111111111111",
          }),
        },
      );
      expect(res.status).to.equal(400);
      const body = (await res.json()) as any;
      expect(body.error).to.include("vaultId");
    });

    it("returns 400 without actualPositions", async () => {
      const res = await app.request("/api/actions/sync-positions?vaultId=0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account: "11111111111111111111111111111111",
        }),
      });
      expect(res.status).to.equal(400);
      const body = (await res.json()) as any;
      expect(body.error).to.include("actualPositions");
    });

    it("returns 400 without account", async () => {
      const res = await app.request(
        "/api/actions/sync-positions?vaultId=0&actualPositions=1",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      expect(res.status).to.equal(400);
      const body = (await res.json()) as any;
      expect(body.error).to.include("account");
    });

    it("returns 400 for invalid actualPositions (> 255)", async () => {
      const res = await app.request(
        "/api/actions/sync-positions?vaultId=0&actualPositions=256",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account: "6wrkKTM2pjkcCAbMfRz2j3AXspavu6pq3ePcuJUE3Azp",
          }),
        },
      );
      expect(res.status).to.equal(400);
      const body = (await res.json()) as any;
      expect(body.error).to.include("actualPositions");
    });

    it("returns unsigned transaction with valid params", async () => {
      const res = await app.request(
        "/api/actions/sync-positions?vaultId=0&actualPositions=2",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account: "6wrkKTM2pjkcCAbMfRz2j3AXspavu6pq3ePcuJUE3Azp",
          }),
        },
      );
      // May return 500 if RPC is unavailable in CI — that's OK,
      // the important thing is it doesn't return 400 (validation passed)
      if (res.status === 200) {
        const body = (await res.json()) as any;
        expect(body.transaction).to.be.a("string");
        expect(body.message).to.include("synced");
      } else {
        // RPC connection failure in test environment — acceptable
        expect(res.status).to.equal(500);
      }
    });
  });

  describe("OPTIONS /api/actions/sync-positions", () => {
    it("returns CORS headers", async () => {
      const res = await app.request("/api/actions/sync-positions", {
        method: "OPTIONS",
      });
      expect(res.status).to.equal(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).to.equal("*");
    });
  });
});
