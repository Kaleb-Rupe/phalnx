import { expect } from "chai";
import type { PhalnxClient } from "@phalnx/sdk";
import {
  phalnxSetup,
  type PhalnxSetupInput,
} from "../../src/tools-v2/phalnx-setup";

describe("phalnx_setup", () => {
  it("returns a string for the 'status' step", async () => {
    const result = await phalnxSetup(null, null, { step: "status" });
    expect(result).to.be.a("string");
    expect(result.length).to.be.greaterThan(0);
  });

  it("returns 'Unknown setup step' for an unrecognized step", async () => {
    // Force an invalid step past TypeScript's type system
    const input = { step: "nonexistent" } as unknown as PhalnxSetupInput;
    const result = await phalnxSetup(null, null, input);
    expect(result).to.include("Unknown setup step");
    expect(result).to.include("nonexistent");
  });

  it("does not throw when client is null for status step", async () => {
    const result = await phalnxSetup(null, null, { step: "status" });
    expect(result).to.be.a("string");
  });

  it("does not throw when client is null for configure step", async () => {
    // configure reads config from disk; without valid config it still returns a string
    const result = await phalnxSetup(null, null, {
      step: "configure",
      params: {},
    });
    expect(result).to.be.a("string");
  });

  it("does not throw when client is null for fundWallet step", async () => {
    const result = await phalnxSetup(null, null, {
      step: "fundWallet",
      params: {},
    });
    expect(result).to.be.a("string");
  });

  it("passes params through to the underlying handler", async () => {
    // discoverVault with a null client should return an error string, not throw
    const result = await phalnxSetup(null, null, {
      step: "discoverVault",
      params: { owner: "11111111111111111111111111111111" },
    });
    expect(result).to.be.a("string");
  });

  it("every enum value is a valid step that returns a string", async () => {
    // Each step gets minimal params to avoid required-field crashes
    const stepsWithParams: Array<{
      step: PhalnxSetupInput["step"];
      params: Record<string, unknown>;
    }> = [
      { step: "status", params: {} },
      { step: "configure", params: {} },
      { step: "configureFromFile", params: {} },
      { step: "fundWallet", params: {} },
      { step: "discoverVault", params: {} },
      { step: "confirmVault", params: {} },
      { step: "provision", params: { platformUrl: "https://example.com" } },
    ];
    for (const { step, params } of stepsWithParams) {
      const result = await phalnxSetup(null, null, { step, params });
      expect(result, `step '${step}' should return a string`).to.be.a("string");
    }
  });
});
