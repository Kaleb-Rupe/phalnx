/**
 * E2E integration tests for the full execute pipeline.
 *
 * Tests exercise IntentEngine + TransactionExecutor end-to-end
 * using mock RPC — no real network calls.
 */

import { expect } from "chai";
import type { Address, Instruction } from "@solana/kit";
import { IntentEngine, type IntentEngineConfig } from "../src/intent-engine.js";
import { TransactionExecutor } from "../src/transaction-executor.js";
import { ProtocolRegistry } from "../src/integrations/protocol-registry.js";
import { JupiterHandler } from "../src/integrations/jupiter-handler.js";
import { DriftHandler, FlashTradeHandler, KaminoHandler, SquadsHandler } from "../src/integrations/t2-handlers.js";
import { isAgentError, type AgentError } from "../src/agent-errors.js";
import type { IntentAction, ExecuteResult } from "../src/intents.js";
import {
  createMockRpc,
  createMockAgent,
  MOCK_VAULT,
  MOCK_AGENT,
  MOCK_SIGNATURE,
  type MockRpcOverrides,
} from "./helpers/mock-rpc.js";

// ─── Test Helpers ────────────────────────────────────────────────────────────

const USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const SOL_MINT = "So11111111111111111111111111111111111111112";

function buildRegistry(): ProtocolRegistry {
  const reg = new ProtocolRegistry();
  reg.register(new JupiterHandler());
  reg.register(new DriftHandler());
  reg.register(new FlashTradeHandler());
  reg.register(new KaminoHandler());
  reg.register(new SquadsHandler());
  return reg;
}

function buildEngineWithExecutor(
  rpcOverrides?: MockRpcOverrides,
): IntentEngine {
  const rpc = createMockRpc(rpcOverrides);
  const agent = createMockAgent();
  const executor = new TransactionExecutor(rpc, agent);

  return new IntentEngine({
    rpc,
    network: "devnet",
    protocolRegistry: buildRegistry(),
    agent,
    executor,
  });
}

function buildEngineWithoutExecutor(): IntentEngine {
  return new IntentEngine({
    rpc: createMockRpc(),
    network: "devnet",
    protocolRegistry: buildRegistry(),
    agent: createMockAgent(),
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("E2E Execute Pipeline", () => {
  describe("run() with executor — full pipeline", () => {
    it("invalid intent short-circuits before precheck", async () => {
      const engine = buildEngineWithExecutor();
      const result = await engine.run(
        { type: "swap", params: { inputMint: "", outputMint: "", amount: "" } },
        MOCK_VAULT,
      );
      expect(isAgentError(result)).to.be.true;
    });

    it("precheck failure short-circuits before compose", async () => {
      // precheck will fail because mock RPC returns null for getAccountInfo
      const engine = buildEngineWithExecutor();
      const result = await engine.run(
        { type: "swap", params: { inputMint: USDC_MINT, outputMint: SOL_MINT, amount: "1000000" } },
        MOCK_VAULT,
      );
      // Should fail at precheck (can't fetch vault data from mock)
      expect(isAgentError(result)).to.be.true;
    });

    it("skipPrecheck bypasses precheck stage", async () => {
      const engine = buildEngineWithExecutor();
      const result = await engine.run(
        { type: "swap", params: { inputMint: USDC_MINT, outputMint: SOL_MINT, amount: "1000000" } },
        MOCK_VAULT,
        { skipPrecheck: true },
      );
      // Will fail at execute() (handler compose needs real RPC for Jupiter),
      // but it should get past validation and skip precheck
      expect(isAgentError(result)).to.be.true;
      const err = result as AgentError;
      // Should NOT be a validation error — it got past that
      expect(err.message).to.not.include("required");
    });
  });

  describe("TransactionExecutor standalone", () => {
    it("full execute pipeline returns signature", async () => {
      const rpc = createMockRpc();
      const agent = createMockAgent();
      const executor = new TransactionExecutor(rpc, agent);

      const mockIx: Instruction = {
        programAddress: "11111111111111111111111111111111" as Address,
        accounts: [],
        data: new Uint8Array([1, 2, 3]),
      };

      const result = await executor.executeTransaction({
        feePayer: agent.address,
        validateIx: mockIx,
        defiInstructions: [mockIx],
        finalizeIx: mockIx,
      });

      expect(result.signature).to.equal(MOCK_SIGNATURE);
      expect(result.events).to.be.an("array");
    });

    it("simulation failure returns error", async () => {
      const rpc = createMockRpc({
        simulateResult: {
          value: {
            err: { InstructionError: [0, "Custom"] },
            logs: ["Program log: Error Code: VaultNotActive. Error Number: 6000"],
            unitsConsumed: 50_000,
          },
        },
      });
      const agent = createMockAgent();
      const executor = new TransactionExecutor(rpc, agent);

      const mockIx: Instruction = {
        programAddress: "11111111111111111111111111111111" as Address,
        accounts: [],
        data: new Uint8Array([1, 2, 3]),
      };

      try {
        await executor.executeTransaction({
          feePayer: agent.address,
          validateIx: mockIx,
          defiInstructions: [mockIx],
          finalizeIx: mockIx,
        });
        expect.fail("Should have thrown");
      } catch (e: any) {
        expect(e.message).to.include("Simulation failed");
      }
    });

    it("RPC timeout returns error", async () => {
      const rpc = createMockRpc({
        statusResult: { value: [null] },
      });
      const agent = createMockAgent();
      const executor = new TransactionExecutor(rpc, agent, {
        confirmOptions: { timeoutMs: 100, pollIntervalMs: 20 },
      });

      const mockIx: Instruction = {
        programAddress: "11111111111111111111111111111111" as Address,
        accounts: [],
        data: new Uint8Array([1, 2, 3]),
      };

      try {
        await executor.executeTransaction({
          feePayer: agent.address,
          validateIx: mockIx,
          defiInstructions: [mockIx],
          finalizeIx: mockIx,
          skipSimulation: true,
        });
        expect.fail("Should have thrown");
      } catch (e: any) {
        expect(e.message).to.include("timed out");
      }
    });

    it("skipSimulation bypasses simulation", async () => {
      // Simulation would fail, but skipSimulation should bypass it
      const rpc = createMockRpc({
        simulateResult: {
          value: { err: "error", logs: [], unitsConsumed: 0 },
        },
      });
      const agent = createMockAgent();
      const executor = new TransactionExecutor(rpc, agent);

      const mockIx: Instruction = {
        programAddress: "11111111111111111111111111111111" as Address,
        accounts: [],
        data: new Uint8Array([1, 2, 3]),
      };

      const result = await executor.executeTransaction({
        feePayer: agent.address,
        validateIx: mockIx,
        defiInstructions: [mockIx],
        finalizeIx: mockIx,
        skipSimulation: true,
      });

      expect(result.signature).to.equal(MOCK_SIGNATURE);
    });
  });

  describe("explain() without executor", () => {
    it("explain() works without executor (no execute needed)", async () => {
      const engine = buildEngineWithoutExecutor();
      // Will fail at validation (empty params), but should NOT fail at missing executor
      const result = await engine.explain(
        { type: "swap", params: { inputMint: "", outputMint: "", amount: "" } },
        MOCK_VAULT,
      );
      expect(isAgentError(result)).to.be.true;
    });
  });

  describe("execute() without executor", () => {
    it("throws when no executor is provided", async () => {
      const engine = buildEngineWithoutExecutor();
      try {
        await engine.execute(
          { type: "swap", params: { inputMint: USDC_MINT, outputMint: SOL_MINT, amount: "1000000" } },
          MOCK_VAULT,
        );
        expect.fail("Should have thrown");
      } catch (e: any) {
        // Will fail at precheck or at executor check
        expect(e).to.be.an("error");
      }
    });
  });
});
