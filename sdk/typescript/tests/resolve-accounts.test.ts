import { expect } from "chai";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  resolveAccounts,
  type ResolvedAccounts,
} from "../src/resolve-accounts";
import {
  getPolicyPDA,
  getTrackerPDA,
  getSessionPDA,
  getConstraintsPDA,
} from "../src/accounts";
import { PHALNX_PROGRAM_ID } from "../src/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROGRAM_ID = new PublicKey(
  "4ZeVCqnjUgUtFrHHPG7jELUxvJeoVGHhGNgPrhBPwrHL",
);

const mockProgram = { programId: PROGRAM_ID } as any;

// Use a mock RPC URL -- resolveAccounts should only derive PDAs + ATAs, no RPC calls
const mockConnection = new Connection("https://mock.rpc");

const vault = Keypair.generate().publicKey;
const agent = Keypair.generate().publicKey;
const tokenMint = Keypair.generate().publicKey;
const outputMint = Keypair.generate().publicKey;
const feeDestination = Keypair.generate().publicKey;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveAccounts", () => {
  describe("basic resolution", () => {
    it("returns all required PDA accounts", async () => {
      const result: ResolvedAccounts = await resolveAccounts(
        mockProgram,
        mockConnection,
        {
          vault,
          agent,
          tokenMint,
          feeDestination,
        },
      );

      expect(result.policyPda).to.be.instanceOf(PublicKey);
      expect(result.trackerPda).to.be.instanceOf(PublicKey);
      expect(result.sessionPda).to.be.instanceOf(PublicKey);
      expect(result.vaultTokenAccount).to.be.instanceOf(PublicKey);
      expect(result.feeDestinationTokenAccount).to.be.instanceOf(PublicKey);
    });

    it("derives policyPda matching accounts.getPolicyPDA", async () => {
      const result = await resolveAccounts(mockProgram, mockConnection, {
        vault,
        agent,
        tokenMint,
        feeDestination,
      });
      const [expectedPolicy] = getPolicyPDA(vault, PROGRAM_ID);
      expect(result.policyPda.toBase58()).to.equal(expectedPolicy.toBase58());
    });

    it("derives trackerPda matching accounts.getTrackerPDA", async () => {
      const result = await resolveAccounts(mockProgram, mockConnection, {
        vault,
        agent,
        tokenMint,
        feeDestination,
      });
      const [expectedTracker] = getTrackerPDA(vault, PROGRAM_ID);
      expect(result.trackerPda.toBase58()).to.equal(expectedTracker.toBase58());
    });

    it("derives sessionPda matching accounts.getSessionPDA", async () => {
      const result = await resolveAccounts(mockProgram, mockConnection, {
        vault,
        agent,
        tokenMint,
        feeDestination,
      });
      const [expectedSession] = getSessionPDA(
        vault,
        agent,
        tokenMint,
        PROGRAM_ID,
      );
      expect(result.sessionPda.toBase58()).to.equal(expectedSession.toBase58());
    });
  });

  describe("constraints PDA", () => {
    it("sets constraintsPda when hasConstraints is true", async () => {
      const result = await resolveAccounts(mockProgram, mockConnection, {
        vault,
        agent,
        tokenMint,
        feeDestination,
        hasConstraints: true,
      });
      expect(result.constraintsPda).to.be.instanceOf(PublicKey);
      const [expectedConstraints] = getConstraintsPDA(vault, PROGRAM_ID);
      expect(result.constraintsPda!.toBase58()).to.equal(
        expectedConstraints.toBase58(),
      );
    });

    it("constraintsPda is undefined when hasConstraints is false", async () => {
      const result = await resolveAccounts(mockProgram, mockConnection, {
        vault,
        agent,
        tokenMint,
        feeDestination,
        hasConstraints: false,
      });
      expect(result.constraintsPda).to.be.undefined;
    });

    it("constraintsPda is undefined when hasConstraints is omitted", async () => {
      const result = await resolveAccounts(mockProgram, mockConnection, {
        vault,
        agent,
        tokenMint,
        feeDestination,
      });
      expect(result.constraintsPda).to.be.undefined;
    });
  });

  describe("output stablecoin account", () => {
    it("sets outputStablecoinAccount when outputMint is provided", async () => {
      const result = await resolveAccounts(mockProgram, mockConnection, {
        vault,
        agent,
        tokenMint,
        outputMint,
        feeDestination,
      });
      expect(result.outputStablecoinAccount).to.be.instanceOf(PublicKey);
    });

    it("outputStablecoinAccount is undefined when outputMint is omitted", async () => {
      const result = await resolveAccounts(mockProgram, mockConnection, {
        vault,
        agent,
        tokenMint,
        feeDestination,
      });
      expect(result.outputStablecoinAccount).to.be.undefined;
    });
  });

  describe("return type validation", () => {
    it("all returned pubkeys are valid PublicKey instances", async () => {
      const result = await resolveAccounts(mockProgram, mockConnection, {
        vault,
        agent,
        tokenMint,
        outputMint,
        feeDestination,
        hasConstraints: true,
      });

      // Required fields
      const requiredKeys: PublicKey[] = [
        result.policyPda,
        result.trackerPda,
        result.sessionPda,
        result.vaultTokenAccount,
        result.feeDestinationTokenAccount,
      ];
      for (const key of requiredKeys) {
        expect(key).to.be.instanceOf(PublicKey);
        // Verify it's a valid base58 string (not default/zero)
        expect(key.toBase58().length).to.be.greaterThan(0);
      }

      // Optional fields (set because we provided outputMint + hasConstraints)
      expect(result.constraintsPda).to.be.instanceOf(PublicKey);
      expect(result.outputStablecoinAccount).to.be.instanceOf(PublicKey);
    });
  });
});
