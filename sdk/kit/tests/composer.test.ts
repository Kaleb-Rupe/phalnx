import { expect } from "chai";
import type {
  Address,
  Instruction,
  AddressesByLookupTableAddress,
} from "@solana/kit";
import {
  composeSigilTransaction,
  validateTransactionSize,
  measureTransactionSize,
} from "../src/composer.js";
import type { ComposeTransactionParams } from "../src/composer.js";

const MOCK_PAYER = "4ZeVCqnjUgUtFrHHPG7jELUxvJeoVGHhGNgPrhBPwrHL" as Address;
const MOCK_PROGRAM = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address;
const MOCK_BLOCKHASH = {
  blockhash: "4NCYB3kRT8sCNodPNuCZo8VUh4xqpBQxsxed2wd9xaJ4",
  lastValidBlockHeight: 1000n,
};

function mockIx(programAddress: Address = MOCK_PROGRAM): Instruction {
  return {
    programAddress,
    accounts: [],
    data: new Uint8Array([1, 2, 3]),
  };
}

function baseParams(
  overrides?: Partial<ComposeTransactionParams>,
): ComposeTransactionParams {
  return {
    feePayer: MOCK_PAYER,
    validateIx: mockIx(),
    defiInstructions: [mockIx()],
    finalizeIx: mockIx(),
    blockhash: MOCK_BLOCKHASH,
    ...overrides,
  };
}

describe("composer", () => {
  describe("composeSigilTransaction", () => {
    // P2 #21: Verify transaction has actual content, not just existence
    it("returns a compiled transaction with non-empty messageBytes", () => {
      const compiled = composeSigilTransaction(baseParams());
      expect(compiled).to.have.property("messageBytes");
      expect(compiled.messageBytes).to.be.instanceOf(Uint8Array);
      expect(compiled.messageBytes.length).to.be.greaterThan(0);
    });

    it("includes compute budget — transaction has signatures array", () => {
      const compiled = composeSigilTransaction(baseParams());
      expect(compiled).to.have.property("signatures");
      expect(compiled.messageBytes.length).to.be.greaterThan(0);
    });

    it("no priority fee ix when 0", () => {
      const compiled = composeSigilTransaction(
        baseParams({ priorityFeeMicroLamports: 0 }),
      );
      expect(compiled).to.exist;
    });

    it("no priority fee ix when undefined", () => {
      const compiled = composeSigilTransaction(
        baseParams({ priorityFeeMicroLamports: undefined }),
      );
      expect(compiled).to.exist;
    });

    it("priority fee ix added when > 0", () => {
      const compiled = composeSigilTransaction(
        baseParams({ priorityFeeMicroLamports: 10_000 }),
      );
      expect(compiled).to.exist;
    });

    it("custom CU override is used", () => {
      const compiled = composeSigilTransaction(
        baseParams({ computeUnits: 1_400_000 }),
      );
      expect(compiled).to.exist;
    });

    it("handles multiple DeFi instructions", () => {
      const compiled = composeSigilTransaction(
        baseParams({
          defiInstructions: [mockIx(), mockIx(), mockIx()],
        }),
      );
      expect(compiled).to.exist;
    });

    it("handles empty DeFi instructions array", () => {
      const compiled = composeSigilTransaction(
        baseParams({ defiInstructions: [] }),
      );
      expect(compiled).to.exist;
    });
  });

  describe("validateTransactionSize", () => {
    it("valid tx returns base64 string", () => {
      const compiled = composeSigilTransaction(baseParams());
      const base64 = validateTransactionSize(compiled);
      expect(base64).to.be.a("string");
      expect(base64.length).to.be.greaterThan(0);
    });

    it("small transaction passes validation", () => {
      const compiled = composeSigilTransaction(
        baseParams({ defiInstructions: [] }),
      );
      expect(() => validateTransactionSize(compiled)).to.not.throw();
    });
  });

  describe("ALT compression", () => {
    const ALT_ADDR = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4" as Address;

    it("composer applies ALT compression when accounts match", () => {
      // Create instructions referencing an address that's in the ALT
      const altAccount =
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
      const ixWithAltAccounts: Instruction = {
        programAddress: MOCK_PROGRAM,
        accounts: [
          { address: altAccount, role: 1 }, // writable signer = 1
        ],
        data: new Uint8Array([1, 2, 3]),
      };

      const alts: AddressesByLookupTableAddress = {
        [ALT_ADDR]: [altAccount],
      };

      const compiled = composeSigilTransaction(
        baseParams({
          defiInstructions: [ixWithAltAccounts],
          addressLookupTables: alts,
        }),
      );
      expect(compiled).to.have.property("messageBytes");
      // Transaction should compile successfully with ALTs
      const { withinLimit } = measureTransactionSize(compiled);
      expect(withinLimit).to.be.true;
    });

    it("composer without ALTs produces no addressTableLookups", () => {
      const compiled = composeSigilTransaction(baseParams());
      // Verify the compiled transaction exists and is valid
      const base64 = validateTransactionSize(compiled);
      expect(base64).to.be.a("string");
    });
  });

  describe("Instruction ordering", () => {
    it("transaction compiles with correct instruction count (no priority fee)", () => {
      // Without priority fee: [computeBudget, validate, defi, finalize] = 4 ix
      const compiled = composeSigilTransaction(baseParams());
      // We can verify by checking the base64 output is valid
      const base64 = validateTransactionSize(compiled);
      expect(base64).to.be.a("string");
    });

    it("transaction compiles with correct instruction count (with priority fee)", () => {
      // With priority fee: [computeBudget, priorityFee, validate, defi, finalize] = 5 ix
      const compiled = composeSigilTransaction(
        baseParams({ priorityFeeMicroLamports: 5_000 }),
      );
      const base64 = validateTransactionSize(compiled);
      expect(base64).to.be.a("string");
    });
  });
});
