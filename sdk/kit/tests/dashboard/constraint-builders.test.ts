/**
 * Unit tests for constraint-builders.ts — the Day-0 fix for the missing
 * 5-instruction allocate→extend→populate chain in `createConstraints` /
 * `queueConstraintsUpdate`.
 *
 * These are pure unit tests: no LiteSVM, no RPC, no signing. The builders
 * compose codama-generated instructions and check the resulting wire size,
 * which is fully deterministic given the inputs. The on-chain integration
 * lives in the existing `tests/instruction-constraints.ts` (Anchor flow);
 * this file pins the SDK contract.
 *
 * What we verify:
 *
 *   1. The chain is exactly 5 instructions (1 alloc + 3 extends + 1 populate).
 *   2. The 5th instruction round-trips through the codama parser and exposes
 *      the caller-supplied entries — the on-chain populate would see them.
 *   3. The 4th instruction (last extend) targets the correct full size
 *      (35,888 for create, 35,904 for queue).
 *   4. Anything that would push the wire bytes past Solana's 1232-byte limit
 *      throws `SIGIL_ERROR__RPC__TX_TOO_LARGE` at build time, not at submit.
 *      A vault left with a partially-allocated PDA is wedged until manual
 *      cleanup, so we MUST fail closed at build time.
 */
import { expect } from "chai";
import {
  type Address,
  type ReadonlyUint8Array,
  type TransactionSigner,
} from "@solana/kit";
import {
  buildCreateConstraintsIxs,
  buildQueueConstraintsUpdateIxs,
  CONSTRAINTS_SIZE,
  PENDING_CONSTRAINTS_SIZE,
} from "../../src/dashboard/constraint-builders.js";
import { parseAllocateConstraintsPdaInstruction } from "../../src/generated/instructions/allocateConstraintsPda.js";
import { parseAllocatePendingConstraintsPdaInstruction } from "../../src/generated/instructions/allocatePendingConstraintsPda.js";
import { parseCreateInstructionConstraintsInstruction } from "../../src/generated/instructions/createInstructionConstraints.js";
import { parseExtendPdaInstruction } from "../../src/generated/instructions/extendPda.js";
import { parseQueueConstraintsUpdateInstruction } from "../../src/generated/instructions/queueConstraintsUpdate.js";
import type { ConstraintEntry } from "../../src/dashboard/types.js";
import { DiscriminatorFormat } from "../../src/generated/types/discriminatorFormat.js";
import { SigilRpcError } from "../../src/errors/rpc.js";
import { SIGIL_ERROR__RPC__TX_TOO_LARGE } from "../../src/errors/codes.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const VAULT = "11111111111111111111111111111112" as Address;
const POLICY = "11111111111111111111111111111113" as Address;
const OWNER_ADDR = "11111111111111111111111111111114" as Address;
const TARGET_PROGRAM = "11111111111111111111111111111115" as Address;
const ACCOUNT_PUBKEY = "11111111111111111111111111111116" as Address;

// PEN-CROSS-3 stub: pure-unit tx-shape tests don't exercise the on-chain
// digest assertion path; they only verify ix bytes/layout. Pass any
// well-formed 32-byte digest.
const STUB_EXPECTED_DIGEST = new Uint8Array(32);

function mockSigner(addr: Address = OWNER_ADDR): TransactionSigner {
  return {
    address: addr,
    signTransactions: async (txs: readonly unknown[]) => txs.map(() => ({})),
  } as unknown as TransactionSigner;
}

/**
 * Build a "fully populated" ConstraintEntry — calibrated so 3 fit within the
 * 1232-byte tx-size limit and 4 do not. The exact layout is:
 *
 *   - programId:           32 bytes
 *   - dataConstraints len:  4 bytes (u32 array prefix)
 *   - 4 × DataConstraint:  4 × (2 offset + 1 op + 4 len + 16 value) = 92 bytes
 *   - accountConstraints:   4 + 4 × (1 index + 32 pubkey) = 136 bytes
 *   - isSpending:           1 byte
 *   - discriminatorFormat:  1 byte
 *
 * That's ~266 bytes per entry. The 5-instruction transaction overhead
 * (signer slot, blockhash, 5 ix headers, account-meta tables for the
 * recurring vault/owner/policy/system-program pubkeys) lands the 3-entry
 * total just under 1232 and the 4-entry total over it. Without ALT
 * compression — the builder is intentionally agnostic to ALTs.
 *
 * Calibration drift: if codama tightens the wire encoding or `Instruction`
 * layout shrinks, the "3 fits" test stays green (becomes more permissive)
 * but the "4 fails" test could start fitting. In that case, bump the
 * value length here OR add a 5th DataConstraint. Both signal a real change
 * in serialization that deserves a deliberate test update, not a silent fix.
 */
function fullyPopulatedEntry(): ConstraintEntry {
  const valueLen = 16;
  const value: ReadonlyUint8Array = new Uint8Array(valueLen).fill(
    0xab,
  ) as unknown as ReadonlyUint8Array;
  return {
    programId: TARGET_PROGRAM,
    dataConstraints: [
      { offset: 0, operator: 0, value },
      { offset: 8, operator: 1, value },
      { offset: 16, operator: 2, value },
      { offset: 24, operator: 3, value },
    ],
    accountConstraints: [
      { index: 0, expected: ACCOUNT_PUBKEY, isWritableRequired: 0 },
      { index: 1, expected: ACCOUNT_PUBKEY, isWritableRequired: 0 },
      { index: 2, expected: ACCOUNT_PUBKEY, isWritableRequired: 0 },
      { index: 3, expected: ACCOUNT_PUBKEY, isWritableRequired: 0 },
    ],
    discriminatorFormat: DiscriminatorFormat.Anchor8,
  };
}

function entries(count: number): ConstraintEntry[] {
  return Array.from({ length: count }, () => fullyPopulatedEntry());
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("buildCreateConstraintsIxs", () => {
  const owner = mockSigner();

  it("produces a 5-instruction chain for a single fully-populated entry", async () => {
    const ixs = await buildCreateConstraintsIxs({
      owner,
      vault: VAULT,
      policy: POLICY,
      entries: entries(1),
      expectedDigest: STUB_EXPECTED_DIGEST,
    });
    expect(ixs).to.have.lengthOf(5);

    // ix 1 = allocate (auto-derives the constraints PDA)
    const allocate = parseAllocateConstraintsPdaInstruction(
      ixs[0]! as Parameters<typeof parseAllocateConstraintsPdaInstruction>[0],
    );
    expect(allocate.accounts.policy.address).to.equal(POLICY);
    expect(allocate.accounts.vault.address).to.equal(VAULT);

    // ixs 2-4 = extend, with monotonically growing target sizes
    const extend1 = parseExtendPdaInstruction(
      ixs[1]! as Parameters<typeof parseExtendPdaInstruction>[0],
    );
    const extend2 = parseExtendPdaInstruction(
      ixs[2]! as Parameters<typeof parseExtendPdaInstruction>[0],
    );
    const extend3 = parseExtendPdaInstruction(
      ixs[3]! as Parameters<typeof parseExtendPdaInstruction>[0],
    );
    expect(extend1.data.targetSize).to.equal(20_480);
    expect(extend2.data.targetSize).to.equal(30_720);
    expect(extend3.data.targetSize).to.equal(CONSTRAINTS_SIZE); // 35_888

    // ix 5 = populate, with the user's entries decoded back out
    const populate = parseCreateInstructionConstraintsInstruction(
      ixs[4]! as Parameters<
        typeof parseCreateInstructionConstraintsInstruction
      >[0],
    );
    expect(populate.data.entries).to.have.lengthOf(1);
    expect(populate.data.entries[0]!.programId).to.equal(TARGET_PROGRAM);
    expect(populate.data.entries[0]!.dataConstraints).to.have.lengthOf(4);
    expect(populate.data.entries[0]!.accountConstraints).to.have.lengthOf(4);
  });

  it("succeeds for 2 fully-populated entries and round-trips them", async () => {
    const ixs = await buildCreateConstraintsIxs({
      owner,
      vault: VAULT,
      policy: POLICY,
      entries: entries(2),
      expectedDigest: STUB_EXPECTED_DIGEST,
    });
    expect(ixs).to.have.lengthOf(5);
    const populate = parseCreateInstructionConstraintsInstruction(
      ixs[4]! as Parameters<
        typeof parseCreateInstructionConstraintsInstruction
      >[0],
    );
    expect(populate.data.entries).to.have.lengthOf(2);
  });

  it("succeeds for 3 fully-populated entries and round-trips them", async () => {
    const ixs = await buildCreateConstraintsIxs({
      owner,
      vault: VAULT,
      policy: POLICY,
      entries: entries(3),
      expectedDigest: STUB_EXPECTED_DIGEST,
    });
    expect(ixs).to.have.lengthOf(5);
    const populate = parseCreateInstructionConstraintsInstruction(
      ixs[4]! as Parameters<
        typeof parseCreateInstructionConstraintsInstruction
      >[0],
    );
    expect(populate.data.entries).to.have.lengthOf(3);
  });

  it("throws SIGIL_ERROR__RPC__TX_TOO_LARGE for 4 fully-populated entries", async () => {
    let caught: unknown;
    try {
      await buildCreateConstraintsIxs({
        owner,
        vault: VAULT,
        policy: POLICY,
        entries: entries(4),
        expectedDigest: STUB_EXPECTED_DIGEST,
      });
    } catch (err) {
      caught = err;
    }
    // Assert by code so a refactor of the SigilRpcError class hierarchy
    // doesn't break this test, while still pinning the contract.
    expect(caught).to.be.instanceOf(SigilRpcError);
    expect((caught as SigilRpcError).code).to.equal(
      SIGIL_ERROR__RPC__TX_TOO_LARGE,
    );
  });

  it("rejects an empty entries array before any I/O", async () => {
    let caught: unknown;
    try {
      await buildCreateConstraintsIxs({
        owner,
        vault: VAULT,
        policy: POLICY,
        entries: [],
        expectedDigest: STUB_EXPECTED_DIGEST,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(Error);
    expect((caught as Error).message).to.match(/non-empty/i);
  });

  it("targets InstructionConstraints::SIZE (35_888) on the final extend", async () => {
    const ixs = await buildCreateConstraintsIxs({
      owner,
      vault: VAULT,
      policy: POLICY,
      expectedDigest: STUB_EXPECTED_DIGEST,
      entries: entries(1),
    });
    // ixs[3] is the final extend (index 3 of 5: alloc=0, extends=1..3, populate=4)
    const lastExtend = parseExtendPdaInstruction(
      ixs[3]! as Parameters<typeof parseExtendPdaInstruction>[0],
    );
    expect(lastExtend.data.targetSize).to.equal(CONSTRAINTS_SIZE);
    expect(lastExtend.data.targetSize).to.equal(35_888);
  });
});

describe("buildQueueConstraintsUpdateIxs", () => {
  const owner = mockSigner();

  it("produces a 5-instruction chain for a single fully-populated entry", async () => {
    const ixs = await buildQueueConstraintsUpdateIxs({
      owner,
      vault: VAULT,
      policy: POLICY,
      entries: entries(1),
    });
    expect(ixs).to.have.lengthOf(5);

    // ix 1 = allocate pending (6 accounts, includes existing constraints)
    const allocate = parseAllocatePendingConstraintsPdaInstruction(
      ixs[0]! as Parameters<
        typeof parseAllocatePendingConstraintsPdaInstruction
      >[0],
    );
    expect(allocate.accounts.policy.address).to.equal(POLICY);
    expect(allocate.accounts.vault.address).to.equal(VAULT);
    // Sanity: the constraints + pendingConstraints PDAs are distinct
    expect(allocate.accounts.constraints.address).to.not.equal(
      allocate.accounts.pendingConstraints.address,
    );

    // ix 5 = queue, with entries decoded back out
    const queue = parseQueueConstraintsUpdateInstruction(
      ixs[4]! as Parameters<typeof parseQueueConstraintsUpdateInstruction>[0],
    );
    expect(queue.data.entries).to.have.lengthOf(1);
    expect(queue.data.entries[0]!.programId).to.equal(TARGET_PROGRAM);
  });

  it("succeeds for 2 fully-populated entries and round-trips them", async () => {
    const ixs = await buildQueueConstraintsUpdateIxs({
      owner,
      vault: VAULT,
      policy: POLICY,
      entries: entries(2),
    });
    expect(ixs).to.have.lengthOf(5);
    const queue = parseQueueConstraintsUpdateInstruction(
      ixs[4]! as Parameters<typeof parseQueueConstraintsUpdateInstruction>[0],
    );
    expect(queue.data.entries).to.have.lengthOf(2);
  });

  it("succeeds for 3 fully-populated entries and round-trips them", async () => {
    const ixs = await buildQueueConstraintsUpdateIxs({
      owner,
      vault: VAULT,
      policy: POLICY,
      entries: entries(3),
    });
    expect(ixs).to.have.lengthOf(5);
    const queue = parseQueueConstraintsUpdateInstruction(
      ixs[4]! as Parameters<typeof parseQueueConstraintsUpdateInstruction>[0],
    );
    expect(queue.data.entries).to.have.lengthOf(3);
  });

  it("throws SIGIL_ERROR__RPC__TX_TOO_LARGE for 4 fully-populated entries", async () => {
    let caught: unknown;
    try {
      await buildQueueConstraintsUpdateIxs({
        owner,
        vault: VAULT,
        policy: POLICY,
        entries: entries(4),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(SigilRpcError);
    expect((caught as SigilRpcError).code).to.equal(
      SIGIL_ERROR__RPC__TX_TOO_LARGE,
    );
  });

  it("rejects an empty entries array before any I/O", async () => {
    let caught: unknown;
    try {
      await buildQueueConstraintsUpdateIxs({
        owner,
        vault: VAULT,
        policy: POLICY,
        entries: [],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(Error);
    expect((caught as Error).message).to.match(/non-empty/i);
  });

  it("targets PendingConstraintsUpdate::SIZE (35_904) on the final extend", async () => {
    const ixs = await buildQueueConstraintsUpdateIxs({
      owner,
      vault: VAULT,
      policy: POLICY,
      entries: entries(1),
    });
    const lastExtend = parseExtendPdaInstruction(
      ixs[3]! as Parameters<typeof parseExtendPdaInstruction>[0],
    );
    expect(lastExtend.data.targetSize).to.equal(PENDING_CONSTRAINTS_SIZE);
    expect(lastExtend.data.targetSize).to.equal(35_904);
  });

  it("differentiates final extend size between create (35_888) and queue (35_904)", async () => {
    const createIxs = await buildCreateConstraintsIxs({
      owner,
      vault: VAULT,
      policy: POLICY,
      entries: entries(1),
      expectedDigest: STUB_EXPECTED_DIGEST,
    });
    const queueIxs = await buildQueueConstraintsUpdateIxs({
      owner,
      vault: VAULT,
      policy: POLICY,
      entries: entries(1),
    });
    const createFinal = parseExtendPdaInstruction(
      createIxs[3]! as Parameters<typeof parseExtendPdaInstruction>[0],
    ).data.targetSize;
    const queueFinal = parseExtendPdaInstruction(
      queueIxs[3]! as Parameters<typeof parseExtendPdaInstruction>[0],
    ).data.targetSize;
    expect(queueFinal - createFinal).to.equal(16);
  });
});
