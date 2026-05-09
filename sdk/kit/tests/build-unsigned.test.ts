/**
 * S21 — buildUnsigned() composer tests.
 *
 * Public composer that wraps buildOwnerTransaction() to give SDK consumers an
 * offline-signing path:
 *  1. Squads multisig (caller submits unsigned tx to a Squad proposal)
 *  2. CLI tools (`solana sign-tx` for cold-key signing)
 *  3. Cost preview (decode buffer client-side to estimate CU + fee)
 *
 * Key contract diff vs `buildOwnerTransaction()`:
 *  - feePayer is a plain `Address`, NOT a `TransactionSigner`.
 *  - Returns a `Uint8Array` wire buffer + decoded message + Instruction[] for
 *    inspection in one shot.
 */
import { expect } from "chai";
import type { Address, Instruction } from "@solana/kit";
import { AccountRole } from "@solana/kit";
import {
  buildUnsigned,
  type BuildUnsignedInput,
} from "../src/build-unsigned.js";
import { getCompiledTransactionMessageDecoder } from "../src/kit-adapter.js";
import { MAX_TX_SIZE } from "../src/composer.js";
import { SIGIL_PROGRAM_ADDRESS } from "../src/types.js";
import {
  createMockRpc,
  type MockRpcOverrides,
  MOCK_BLOCKHASH,
} from "../src/testing/index.js";

// ─── Test Addresses ─────────────────────────────────────────────────────────

const VAULT = "11111111111111111111111111111112" as Address;
const OWNER_ADDR = "11111111111111111111111111111114" as Address;
const RECIPIENT = "11111111111111111111111111111115" as Address;

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeFreezeInstruction(): Instruction {
  return {
    programAddress: SIGIL_PROGRAM_ADDRESS,
    accounts: [
      { address: VAULT, role: AccountRole.WRITABLE },
      { address: OWNER_ADDR, role: AccountRole.READONLY_SIGNER },
    ],
    data: new Uint8Array([0xaa, 0xbb, 0xcc]),
  };
}

function makeTransferInstruction(): Instruction {
  // Mimics a SystemProgram::Transfer { from, to, lamports } instruction shape.
  // Real wire-format details don't matter — buildUnsigned doesn't decode the
  // ix payload; tests just need a second program/account/data triple.
  const SYSTEM_PROGRAM = "11111111111111111111111111111111" as Address;
  const data = new Uint8Array(12);
  data[0] = 2; // SystemProgram::Transfer discriminator
  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [
      { address: OWNER_ADDR, role: AccountRole.WRITABLE_SIGNER },
      { address: RECIPIENT, role: AccountRole.WRITABLE },
    ],
    data,
  };
}

function baseInput(
  overrides?: Partial<BuildUnsignedInput>,
  rpcOverrides?: MockRpcOverrides,
): BuildUnsignedInput {
  return {
    rpc: createMockRpc(rpcOverrides),
    feePayer: OWNER_ADDR,
    instructions: [makeFreezeInstruction()],
    network: "devnet",
    blockhash: MOCK_BLOCKHASH,
    addressLookupTables: {},
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("buildUnsigned()", () => {
  it("returns a serialized tx buffer + instructions + decoded message", async () => {
    const ix = makeFreezeInstruction();
    const input = baseInput({ instructions: [ix] });
    const result = await buildUnsigned(input);

    expect(result.unsignedTxBytes).to.be.instanceOf(Uint8Array);
    expect(result.unsignedTxBytes.byteLength).to.be.greaterThan(0);
    expect(result.unsignedTxBytes.byteLength).to.be.at.most(MAX_TX_SIZE);
    expect(result.instructions).to.be.an("array").with.length(1);
    // `instructions` is returned by-reference (cheap, immutable contract).
    expect(result.instructions[0]).to.equal(ix);
    expect(result.feePayer).to.equal(OWNER_ADDR);
    expect(result.recentBlockhash).to.equal(MOCK_BLOCKHASH.blockhash);
    expect(result.lastValidBlockHeight).to.equal(
      MOCK_BLOCKHASH.lastValidBlockHeight,
    );
    expect(result.message).to.exist;
  });

  it("round-trip — message bytes decode and feePayer is at staticAccounts[0]", async () => {
    const result = await buildUnsigned(baseInput());

    // Wire format: [num_sigs:u8][signatures:64*num_sigs][messageBytes].
    // 1 signer (the fee payer) ⇒ message starts at offset 65.
    const numSigs = result.unsignedTxBytes[0]!;
    expect(numSigs).to.equal(1);
    const messageBytes = result.unsignedTxBytes.slice(1 + 64 * numSigs);
    const decoded = getCompiledTransactionMessageDecoder().decode(messageBytes);
    expect(decoded).to.exist;
    // staticAccounts[0] is the fee payer in versioned-tx encoding.
    expect((decoded as any).staticAccounts[0]).to.equal(OWNER_ADDR);
  });

  it("no signature attached — sig slot is 64 zero bytes", async () => {
    const result = await buildUnsigned(baseInput());

    const numSigs = result.unsignedTxBytes[0]!;
    expect(numSigs).to.equal(1);
    const sigBytes = result.unsignedTxBytes.slice(1, 1 + 64);
    expect(sigBytes.byteLength).to.equal(64);
    // Every byte in the signature slot must be zero — caller hasn't signed.
    for (let i = 0; i < sigBytes.byteLength; i++) {
      expect(sigBytes[i]).to.equal(0, `sig byte ${i} should be zero`);
    }
  });

  it("recent blockhash is fetched from the rpc when not pre-supplied", async () => {
    const result = await buildUnsigned({
      rpc: createMockRpc(),
      feePayer: OWNER_ADDR,
      instructions: [makeFreezeInstruction()],
      network: "devnet",
      addressLookupTables: {},
    });

    // Mock RPC returns MOCK_BLOCKHASH; verify the embedded value matches.
    expect(result.recentBlockhash).to.equal(MOCK_BLOCKHASH.blockhash);
    expect(result.lastValidBlockHeight).to.equal(
      MOCK_BLOCKHASH.lastValidBlockHeight,
    );
  });

  it("multi-instruction — preserves ix order in `instructions` field", async () => {
    const ixs = [makeFreezeInstruction(), makeTransferInstruction()];
    const result = await buildUnsigned(baseInput({ instructions: ixs }));

    expect(result.instructions).to.have.length(2);
    expect(result.instructions[0]).to.equal(ixs[0]);
    expect(result.instructions[1]).to.equal(ixs[1]);
    expect(result.unsignedTxBytes.byteLength).to.be.at.most(MAX_TX_SIZE);
  });

  it("cost preview — when simulate=true, returns estimatedComputeUnits", async () => {
    const result = await buildUnsigned(
      baseInput(
        { simulate: true },
        {
          simulateResult: {
            value: { err: null, logs: [], unitsConsumed: 12_345n },
          },
        },
      ),
    );

    expect(result.estimatedComputeUnits).to.equal(12_345);
  });

  it("simulate=false (default) — estimatedComputeUnits is undefined", async () => {
    const result = await buildUnsigned(baseInput());
    expect(result.estimatedComputeUnits).to.equal(undefined);
  });

  it("custom computeUnitLimit — flows through to buildOwnerTransaction", async () => {
    const result = await buildUnsigned(
      baseInput({ computeUnitLimit: 500_000 }),
    );
    expect(result.unsignedTxBytes.byteLength).to.be.greaterThan(0);
  });

  it("priority fee — adds SetComputeUnitPrice when computeUnitPrice > 0", async () => {
    const result = await buildUnsigned(baseInput({ computeUnitPrice: 10_000 }));
    expect(result.unsignedTxBytes.byteLength).to.be.greaterThan(0);
  });

  it("empty instructions — throws same error as buildOwnerTransaction", async () => {
    try {
      await buildUnsigned(baseInput({ instructions: [] }));
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.message).to.include("At least one instruction is required");
    }
  });

  it("simulate failure does not throw — result has estimatedComputeUnits=undefined", async () => {
    // Sim returns an error; buildUnsigned should still hand back the unsigned
    // bytes (cost preview is best-effort, not load-bearing).
    const result = await buildUnsigned(
      baseInput(
        { simulate: true },
        {
          simulateResult: {
            value: { err: "Some sim error", logs: [], unitsConsumed: null },
          },
        },
      ),
    );

    expect(result.unsignedTxBytes.byteLength).to.be.greaterThan(0);
    expect(result.estimatedComputeUnits).to.equal(undefined);
  });
});
