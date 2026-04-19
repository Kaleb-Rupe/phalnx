/**
 * Tests for the SAK plugin's custody bridge helper.
 *
 * Moved from sdk/kit/tests/custody-adapter.test.ts in v0.13.0 when the
 * helper migrated from @usesigil/kit into the plugins package. Covers:
 *   - Correct address propagation from adapter to signer
 *   - signTransactions delegates to adapter.sign with messageBytes
 *   - Signature placed at the correct address key in the result dict
 *   - Batch signing preserves order + call count
 *   - Adapter errors propagate cleanly
 *   - Optional attestation() method — present vs absent
 */

import { expect } from "chai";
import { describe, it } from "mocha";
import type { Address } from "@solana/kit";
import {
  custodyAdapterToTransactionSigner,
  type CustodyAdapter,
} from "../src/sak/signer.js";
import type { AttestationResult } from "@usesigil/kit";
import { AttestationStatus } from "@usesigil/kit";

// ─── Test Constants ────────────────────────────────────────────────────────

const MOCK_ADDRESS = "CustodyMockAddr1111111111111111111111111111" as Address;
const MOCK_SIG = new Uint8Array(64).fill(0xab);
const MOCK_MESSAGE = new Uint8Array([1, 2, 3, 4, 5]);

// ─── Mock Adapter ──────────────────────────────────────────────────────────

function createMockAdapter(opts?: {
  address?: Address;
  sig?: Uint8Array;
  signFn?: (bytes: Uint8Array) => Promise<Uint8Array>;
  withAttestation?: boolean;
}): CustodyAdapter {
  const adapter: CustodyAdapter = {
    getPublicKey: () => opts?.address ?? MOCK_ADDRESS,
    sign: opts?.signFn ?? (async () => opts?.sig ?? MOCK_SIG),
  };

  if (opts?.withAttestation) {
    adapter.attestation = async (): Promise<AttestationResult> => ({
      status: AttestationStatus.ProviderVerified,
      provider: "turnkey",
      publicKey: (opts?.address ?? MOCK_ADDRESS) as string,
      metadata: {
        provider: "turnkey",
        verifiedAt: Date.now(),
      },
      message: "Provider verified",
    });
  }

  return adapter;
}

function mockTx(messageBytes?: Uint8Array) {
  return {
    messageBytes: messageBytes ?? MOCK_MESSAGE,
    signatures: {},
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("CustodyAdapter (SAK plugin)", () => {
  describe("custodyAdapterToTransactionSigner", () => {
    it("returns signer with correct address", () => {
      const adapter = createMockAdapter();
      const signer = custodyAdapterToTransactionSigner(adapter);
      expect(signer.address).to.equal(MOCK_ADDRESS);
    });

    it("returned signer has signTransactions method", () => {
      const adapter = createMockAdapter();
      const signer = custodyAdapterToTransactionSigner(
        adapter,
      ) as unknown as Record<string, unknown>;
      expect(typeof signer.signTransactions).to.equal("function");
    });

    it("signTransactions calls adapter.sign() with messageBytes", async () => {
      let receivedBytes: Uint8Array | null = null;
      const adapter = createMockAdapter({
        signFn: async (bytes) => {
          receivedBytes = bytes;
          return MOCK_SIG;
        },
      });
      const signer = custodyAdapterToTransactionSigner(adapter) as unknown as {
        signTransactions: (
          txs: readonly { messageBytes: Uint8Array }[],
        ) => Promise<readonly Record<string, Uint8Array>[]>;
      };

      await signer.signTransactions([mockTx()]);
      expect(receivedBytes).to.deep.equal(MOCK_MESSAGE);
    });

    it("signature placed at correct address key in dictionary", async () => {
      const adapter = createMockAdapter();
      const signer = custodyAdapterToTransactionSigner(adapter) as unknown as {
        signTransactions: (
          txs: readonly { messageBytes: Uint8Array }[],
        ) => Promise<readonly Record<string, Uint8Array>[]>;
      };
      const [sigDict] = await signer.signTransactions([mockTx()]);

      expect(sigDict).to.have.property(MOCK_ADDRESS);
      expect(sigDict[MOCK_ADDRESS]).to.deep.equal(MOCK_SIG);
    });

    it("signs multiple transactions in a batch", async () => {
      let callCount = 0;
      const adapter = createMockAdapter({
        signFn: async () => {
          callCount++;
          return MOCK_SIG;
        },
      });
      const signer = custodyAdapterToTransactionSigner(adapter) as unknown as {
        signTransactions: (
          txs: readonly { messageBytes: Uint8Array }[],
        ) => Promise<readonly Record<string, Uint8Array>[]>;
      };

      const results = await signer.signTransactions([
        mockTx(new Uint8Array([1])),
        mockTx(new Uint8Array([2])),
        mockTx(new Uint8Array([3])),
      ]);

      expect(results).to.have.length(3);
      expect(callCount).to.equal(3);
      for (const sigDict of results) {
        expect(sigDict).to.have.property(MOCK_ADDRESS);
      }
    });

    it("handles async sign rejection (adapter.sign throws)", async () => {
      const adapter = createMockAdapter({
        signFn: async () => {
          throw new Error("HSM connection lost");
        },
      });
      const signer = custodyAdapterToTransactionSigner(adapter) as unknown as {
        signTransactions: (
          txs: readonly { messageBytes: Uint8Array }[],
        ) => Promise<readonly Record<string, Uint8Array>[]>;
      };

      try {
        await signer.signTransactions([mockTx()]);
        expect.fail("Should have thrown");
      } catch (err: unknown) {
        expect((err as Error).message).to.equal("HSM connection lost");
      }
    });

    it("works without attestation() method (optional)", () => {
      const adapter = createMockAdapter({ withAttestation: false });
      expect(adapter.attestation).to.be.undefined;

      const signer = custodyAdapterToTransactionSigner(adapter);
      expect(signer.address).to.equal(MOCK_ADDRESS);
    });

    it("attestation() returns result when present", async () => {
      const adapter = createMockAdapter({ withAttestation: true });
      expect(adapter.attestation).to.be.a("function");

      const result = await adapter.attestation!();
      expect(result).to.not.be.null;
      expect(result!.status).to.equal(AttestationStatus.ProviderVerified);
      expect(result!.provider).to.equal("turnkey");
    });
  });
});
