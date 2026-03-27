/**
 * Tests for createAndSendVault() convenience function.
 *
 * createAndSendVault() composes createVault() → buildOwnerTransaction()
 * → signAndEncode() → sendAndConfirmTransaction(). Integration testing
 * requires LiteSVM or devnet. This file tests preconditions only.
 */

import { expect } from "chai";
import { createAndSendVault } from "../src/create-vault.js";
import type { Address, TransactionSigner } from "@solana/kit";

function createMockSigner(addr: Address): TransactionSigner {
  return {
    address: addr,
    signTransactions: async (txs: unknown[]) => txs,
  } as unknown as TransactionSigner;
}

const OWNER = "4ZeVCqnjUgUtFrHHPG7jELUxvJeoVGHhGNgPrhBPwrHL" as Address;
const AGENT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address;

describe("createAndSendVault", () => {
  it("rejects owner === agent with exact error message", async () => {
    try {
      await createAndSendVault({
        rpc: {} as any,
        network: "devnet",
        owner: createMockSigner(OWNER),
        agent: createMockSigner(OWNER),
      });
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as Error).message).to.equal(
        "Owner and agent must be different keys. " +
          "The owner has full vault authority; the agent has constrained execution only.",
      );
    }
  });
});
