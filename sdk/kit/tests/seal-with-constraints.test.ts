/**
 * Tests for seal() wiring the InstructionConstraints PDA into
 * validate_and_authorize via remainingAccounts.
 *
 * BACKGROUND
 * ──────────
 * The on-chain `validate_and_authorize` handler reads the constraints PDA
 * from `ctx.remaining_accounts[0]` (programs/sigil/src/instructions/
 * validate_and_authorize.rs:141-177). Two failure modes exist if the SDK
 * forgets to wire it:
 *   1. policy.has_constraints == true + remaining_accounts empty
 *      → on-chain hard-fails with InvalidConstraintsPda (rs:175).
 *   2. policy.has_constraints == false + remaining_accounts non-empty
 *      → on-chain treats it as the constraints PDA and rejects the wrong
 *        owner / vault.
 *
 * Before this fix, `seal()` never appended the PDA, so any vault with
 * has_constraints == true was unusable end-to-end (PR 1 created the
 * write path but the runtime read path was wired only at the on-chain
 * handler — the SDK side was inert).
 *
 * WHY UNIT-LEVEL VERIFICATION
 * ───────────────────────────
 * The kit test harness uses mocha + tsx + cachedState mocks. Live
 * LiteSVM/devnet seal flows live in `tests/sigil.ts` (legacy
 * Anchor-JS/LiteSVM) and `sdk/kit/tests/devnet/seal-e2e.test.ts`
 * (gated by ANCHOR_PROVIDER_URL). The on-chain matcher itself is
 * tested in `tests/instruction-constraints.ts`.
 *
 * What we verify HERE is the SDK contract: when
 * policy.hasConstraints == true the compiled transaction MUST
 * include the constraints PDA among its static accounts; when
 * false, it MUST NOT. This is the only piece PR 1b touches —
 * the on-chain semantics are already covered elsewhere.
 */

import { expect } from "chai";
import type { Address } from "@solana/kit";
import { AccountRole } from "@solana/kit";
import { seal, type SealParams } from "../src/seal.js";
import { getCompiledTransactionMessageDecoder } from "../src/kit-adapter.js";
import { getConstraintsPDA } from "../src/resolve-accounts.js";
import type { ResolvedVaultState } from "../src/state-resolver.js";
import { USDC_MINT_DEVNET } from "../src/types.js";
import { createMockAgent, createMockVaultState } from "../src/testing/index.js";

// ─── Test Addresses ─────────────────────────────────────────────────────────

const VAULT = "11111111111111111111111111111112" as Address;
const AGENT_ADDR = "11111111111111111111111111111113" as Address;
const OWNER_ADDR = "11111111111111111111111111111114" as Address;
const FEE_DEST = "11111111111111111111111111111115" as Address;
const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4" as Address;

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockAgent() {
  return createMockAgent(AGENT_ADDR);
}

function jupiterIx() {
  return {
    programAddress: JUPITER,
    accounts: [{ address: VAULT, role: AccountRole.WRITABLE }],
    data: new Uint8Array([1, 2, 3]),
  };
}

function makeStateWithConstraints(hasConstraints: boolean): ResolvedVaultState {
  const state = createMockVaultState({
    vault: VAULT,
    agent: AGENT_ADDR,
    owner: OWNER_ADDR,
    feeDestination: FEE_DEST,
  });
  // The mock factory always sets hasConstraints=false; we override here.
  state.policy.hasConstraints = hasConstraints;
  return state;
}

function baseParams(
  hasConstraints: boolean,
  overrides?: Partial<SealParams>,
): SealParams {
  return {
    vault: VAULT,
    agent: mockAgent(),
    instructions: [jupiterIx()],
    rpc: {} as any,
    network: "devnet",
    tokenMint: USDC_MINT_DEVNET,
    amount: 100_000_000n, // $100
    cachedState: makeStateWithConstraints(hasConstraints),
    blockhash: {
      blockhash: "GHtXQBpokCiBP6spMNfMW9qLBjfQJhmR4GWzCiQ2ATQA",
      lastValidBlockHeight: 200n,
    },
    ...overrides,
  };
}

/**
 * Decode the compiled transaction's static account list. With ALTs disabled
 * (the test harness provides no `addressLookupTables`), every account
 * referenced by any instruction shows up here — including remaining
 * accounts. Presence of the constraints PDA in this list is a proxy for
 * "the validate ix included it as a remainingAccount."
 */
function staticAccountsOf(
  result: Awaited<ReturnType<typeof seal>>,
): readonly Address[] {
  const decoded = getCompiledTransactionMessageDecoder().decode(
    result.transaction.messageBytes,
  ) as { staticAccounts: readonly Address[] };
  return decoded.staticAccounts;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("seal() — InstructionConstraints PDA wiring", () => {
  it("appends the constraints PDA when policy.hasConstraints === true", async () => {
    const params = baseParams(true);
    const result = await seal(params);

    const expectedPda = (await getConstraintsPDA(VAULT))[0];
    const accounts = staticAccountsOf(result);

    // The PDA must appear in the compiled message. If it doesn't, the
    // codama-generated validate_and_authorize ix never received it as a
    // remainingAccount and the on-chain handler will silently skip the
    // matcher (or hard-fail with InvalidConstraintsPda when has_constraints
    // is set on the policy, which is the case here).
    expect(accounts).to.include(expectedPda);
  });

  it("does NOT append the constraints PDA when policy.hasConstraints === false", async () => {
    const params = baseParams(false);
    const result = await seal(params);

    const expectedPda = (await getConstraintsPDA(VAULT))[0];
    const accounts = staticAccountsOf(result);

    // Symmetric: when the vault has no constraints configured, the SDK
    // must NOT pass the PDA. If it did, the on-chain handler at line
    // 144 of validate_and_authorize.rs would reject because
    // info.owner == &crate::ID would be checked against an unallocated
    // account (owner is system_program, not sigil), failing
    // InvalidConstraintsPda.
    expect(accounts).to.not.include(expectedPda);
  });

  it("constraints PDA derivation is deterministic from vault address", async () => {
    // Sanity check on the helper used by the wire-up path. If
    // getConstraintsPDA started returning different PDAs across calls
    // for the same vault, the on-chain InvalidConstraintsPda check
    // (which compares info.key() against the create_program_address
    // recomputation using the stored bump) would intermittently fail.
    const a = (await getConstraintsPDA(VAULT))[0];
    const b = (await getConstraintsPDA(VAULT))[0];
    expect(a).to.equal(b);
  });

  it("hasConstraints toggle is the ONLY factor that adds the PDA", async () => {
    // Same params, only hasConstraints differs. The compiled transactions
    // must differ in their staticAccounts: the hasConstraints=true case
    // has exactly one extra address (the constraints PDA).
    const withCx = await seal(baseParams(true));
    const withoutCx = await seal(baseParams(false));

    const withCxAccounts = staticAccountsOf(withCx);
    const withoutCxAccounts = staticAccountsOf(withoutCx);

    const expectedPda = (await getConstraintsPDA(VAULT))[0];

    // Diff: with-constraints message has the PDA, without does not.
    const onlyInWith = withCxAccounts.filter(
      (a) => !withoutCxAccounts.includes(a),
    );
    expect(onlyInWith).to.deep.equal([expectedPda]);
  });

  it("transaction still composes successfully with the extra account", async () => {
    // Regression guard: the extra remainingAccount must not push the
    // transaction over the 1232-byte wire limit for a typical Jupiter
    // seal. The composer throws TX_TOO_LARGE if it does — we want a
    // clean success here so we know the wire-up doesn't silently
    // break short paths.
    const result = await seal(baseParams(true));
    expect(result.txSizeBytes).to.be.greaterThan(0);
    expect(result.txSizeBytes).to.be.at.most(1232);
    expect(result.transaction.messageBytes.length).to.be.greaterThan(0);
  });
});
