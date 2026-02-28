/// <reference types="node" />
import { expect } from "chai";
import {
  configureJupiterApi,
  getJupiterApiConfig,
  resetJupiterApiConfig,
  jupiterFetch,
  JupiterApiError,
} from "../src/integrations/jupiter-api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

function mockFetch(
  handler: (url: string, init?: any) => Promise<Response>,
): void {
  (globalThis as any).fetch = handler;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("jupiter-api", () => {
  afterEach(() => {
    resetJupiterApiConfig();
    (globalThis as any).fetch = originalFetch;
  });

  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  describe("configureJupiterApi", () => {
    it("sets config values", () => {
      configureJupiterApi({
        apiKey: "my-key",
        baseUrl: "https://custom.jup.ag",
        maxRetries: 5,
        retryDelayMs: 500,
        timeoutMs: 10_000,
      });

      const cfg = getJupiterApiConfig();
      expect(cfg.apiKey).to.equal("my-key");
      expect(cfg.baseUrl).to.equal("https://custom.jup.ag");
      expect(cfg.maxRetries).to.equal(5);
      expect(cfg.retryDelayMs).to.equal(500);
      expect(cfg.timeoutMs).to.equal(10_000);
    });

    it("strips trailing slash from baseUrl", () => {
      configureJupiterApi({ baseUrl: "https://custom.jup.ag/" });
      expect(getJupiterApiConfig().baseUrl).to.equal("https://custom.jup.ag");
    });
  });

  describe("getJupiterApiConfig", () => {
    it("returns defaults when not configured", () => {
      const cfg = getJupiterApiConfig();
      expect(cfg.apiKey).to.equal("");
      expect(cfg.baseUrl).to.equal("https://api.jup.ag");
      expect(cfg.maxRetries).to.equal(3);
      expect(cfg.retryDelayMs).to.equal(1000);
      expect(cfg.timeoutMs).to.equal(30_000);
    });
  });

  describe("resetJupiterApiConfig", () => {
    it("resets to defaults after custom config", () => {
      configureJupiterApi({
        apiKey: "temp-key",
        maxRetries: 10,
      });
      resetJupiterApiConfig();

      const cfg = getJupiterApiConfig();
      expect(cfg.apiKey).to.equal("");
      expect(cfg.maxRetries).to.equal(3);
    });
  });

  // -----------------------------------------------------------------------
  // jupiterFetch — basic requests
  // -----------------------------------------------------------------------

  describe("jupiterFetch", () => {
    it("makes GET requests with correct URL", async () => {
      let capturedUrl = "";
      let capturedInit: any;

      mockFetch(async (url, init) => {
        capturedUrl = url;
        capturedInit = init;
        return jsonResponse({ price: 42 });
      });

      const result = await jupiterFetch<{ price: number }>(
        "/v6/quote?inputMint=SOL",
      );

      expect(capturedUrl).to.equal("https://api.jup.ag/v6/quote?inputMint=SOL");
      expect(capturedInit.method).to.equal("GET");
      expect(result.price).to.equal(42);
    });

    it("injects x-api-key header when configured", async () => {
      configureJupiterApi({ apiKey: "secret-key-123" });
      let capturedHeaders: Record<string, string> = {};

      mockFetch(async (_url, init) => {
        capturedHeaders = init.headers;
        return jsonResponse({ ok: true });
      });

      await jupiterFetch("/v6/quote");

      expect(capturedHeaders["x-api-key"]).to.equal("secret-key-123");
    });

    it("does NOT inject x-api-key when not configured", async () => {
      let capturedHeaders: Record<string, string> = {};

      mockFetch(async (_url, init) => {
        capturedHeaders = init.headers;
        return jsonResponse({ ok: true });
      });

      await jupiterFetch("/v6/quote");

      expect(capturedHeaders).to.not.have.property("x-api-key");
    });

    it("makes POST requests with JSON body", async () => {
      let capturedInit: any;

      mockFetch(async (_url, init) => {
        capturedInit = init;
        return jsonResponse({ txn: "abc" });
      });

      const result = await jupiterFetch<{ txn: string }>("/v6/swap", {
        method: "POST",
        body: { inputMint: "SOL", outputMint: "USDC" },
      });

      expect(capturedInit.method).to.equal("POST");
      expect(JSON.parse(capturedInit.body)).to.deep.equal({
        inputMint: "SOL",
        outputMint: "USDC",
      });
      expect(result.txn).to.equal("abc");
    });

    it("sets Content-Type for POST with body", async () => {
      let capturedHeaders: Record<string, string> = {};

      mockFetch(async (_url, init) => {
        capturedHeaders = init.headers;
        return jsonResponse({ ok: true });
      });

      await jupiterFetch("/v6/swap", {
        method: "POST",
        body: { data: "test" },
      });

      expect(capturedHeaders["Content-Type"]).to.equal("application/json");
    });

    it("uses custom baseUrl", async () => {
      configureJupiterApi({ baseUrl: "https://staging.jup.ag" });
      let capturedUrl = "";

      mockFetch(async (url) => {
        capturedUrl = url;
        return jsonResponse({ ok: true });
      });

      await jupiterFetch("/v6/quote");

      expect(capturedUrl).to.equal("https://staging.jup.ag/v6/quote");
    });

    // ---------------------------------------------------------------------
    // Error handling
    // ---------------------------------------------------------------------

    it("throws JupiterApiError on 400", async () => {
      configureJupiterApi({ maxRetries: 0, retryDelayMs: 1 });

      mockFetch(async () => textResponse("Bad Request", 400));

      try {
        await jupiterFetch("/v6/quote");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).to.be.instanceOf(JupiterApiError);
        const apiErr = err as JupiterApiError;
        expect(apiErr.statusCode).to.equal(400);
        expect(apiErr.body).to.equal("Bad Request");
      }
    });

    it("throws JupiterApiError on 404", async () => {
      configureJupiterApi({ maxRetries: 0, retryDelayMs: 1 });

      mockFetch(async () => textResponse("Not Found", 404));

      try {
        await jupiterFetch("/v6/nonexistent");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).to.be.instanceOf(JupiterApiError);
        const apiErr = err as JupiterApiError;
        expect(apiErr.statusCode).to.equal(404);
        expect(apiErr.body).to.equal("Not Found");
      }
    });

    // ---------------------------------------------------------------------
    // Retry behavior
    // ---------------------------------------------------------------------

    it("retries on 429 and succeeds on retry", async () => {
      configureJupiterApi({ retryDelayMs: 1 });
      let callCount = 0;

      mockFetch(async () => {
        callCount++;
        if (callCount === 1) {
          return textResponse("Rate Limited", 429);
        }
        return jsonResponse({ retried: true });
      });

      const result = await jupiterFetch<{ retried: boolean }>("/v6/quote");

      expect(callCount).to.equal(2);
      expect(result.retried).to.equal(true);
    });

    it("retries on 500 and succeeds on retry", async () => {
      configureJupiterApi({ retryDelayMs: 1 });
      let callCount = 0;

      mockFetch(async () => {
        callCount++;
        if (callCount === 1) {
          return textResponse("Internal Server Error", 500);
        }
        return jsonResponse({ recovered: true });
      });

      const result = await jupiterFetch<{ recovered: boolean }>("/v6/quote");

      expect(callCount).to.equal(2);
      expect(result.recovered).to.equal(true);
    });

    it("respects maxRetries=0 (no retries on 429)", async () => {
      configureJupiterApi({ maxRetries: 0, retryDelayMs: 1 });
      let callCount = 0;

      mockFetch(async () => {
        callCount++;
        return textResponse("Rate Limited", 429);
      });

      try {
        await jupiterFetch("/v6/quote");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).to.be.instanceOf(JupiterApiError);
        expect((err as JupiterApiError).statusCode).to.equal(429);
        expect(callCount).to.equal(1);
      }
    });

    it("throws after exhausting retries on 500", async () => {
      configureJupiterApi({ maxRetries: 2, retryDelayMs: 1 });
      let callCount = 0;

      mockFetch(async () => {
        callCount++;
        return textResponse("Server Error", 500);
      });

      try {
        await jupiterFetch("/v6/quote");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).to.be.instanceOf(JupiterApiError);
        expect((err as JupiterApiError).statusCode).to.equal(500);
        // 1 initial + 2 retries = 3 total calls
        expect(callCount).to.equal(3);
      }
    });
  });
});
