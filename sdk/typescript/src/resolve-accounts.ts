/**
 * Account Resolution — Auto-derive PDA accounts for composed transactions
 *
 * Reduces the 15-20 manual account inputs agents need to provide
 * down to just vault + agent + tokenMint.
 */

import { PublicKey, Connection } from "@solana/web3.js";
import type { Program } from "@coral-xyz/anchor";
import type { Phalnx } from "./types";
import {
  getPolicyPDA,
  getTrackerPDA,
  getSessionPDA,
  getConstraintsPDA,
  getAgentOverlayPDA,
} from "./accounts";

export interface ResolvedAccounts {
  vault: PublicKey;
  policyPda: PublicKey;
  trackerPda: PublicKey;
  sessionPda: PublicKey;
  vaultTokenAccount: PublicKey;
  feeDestinationTokenAccount: PublicKey;
  protocolTreasuryTokenAccount: PublicKey;
  constraintsPda?: PublicKey;
  agentOverlayPda?: PublicKey;
  outputStablecoinAccount?: PublicKey;
}

export interface ResolveAccountsInput {
  /** The vault PDA address */
  vault: PublicKey;
  /** The agent signing key */
  agent: PublicKey;
  /** The token mint for the action */
  tokenMint: PublicKey;
  /** Optional output mint (for non-stablecoin swaps) */
  outputMint?: PublicKey;
  /** Fee destination (from vault account) */
  feeDestination?: PublicKey;
  /** Whether the vault has constraints configured */
  hasConstraints?: boolean;
}

/**
 * Auto-derive all PDA accounts needed for a composed Phalnx transaction.
 *
 * @param program - Anchor program instance
 * @param _connection - Solana connection (reserved for future on-chain lookups)
 * @param input - Minimal input: vault, agent, tokenMint
 */
export async function resolveAccounts(
  program: Program<Phalnx>,
  _connection: Connection,
  input: ResolveAccountsInput,
): Promise<ResolvedAccounts> {
  const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");

  const [policyPda] = getPolicyPDA(input.vault, program.programId);
  const [trackerPda] = getTrackerPDA(input.vault, program.programId);
  const [sessionPda] = getSessionPDA(
    input.vault,
    input.agent,
    input.tokenMint,
    program.programId,
  );

  const vaultTokenAccount = getAssociatedTokenAddressSync(
    input.tokenMint,
    input.vault,
    true, // allowOwnerOffCurve for PDA
  );

  const feeDestinationTokenAccount = input.feeDestination
    ? getAssociatedTokenAddressSync(input.tokenMint, input.feeDestination, true)
    : getAssociatedTokenAddressSync(
        input.tokenMint,
        program.programId,
        true,
      );

  const protocolTreasuryTokenAccount = getAssociatedTokenAddressSync(
    input.tokenMint,
    program.programId,
    true,
  );

  const result: ResolvedAccounts = {
    vault: input.vault,
    policyPda,
    trackerPda,
    sessionPda,
    vaultTokenAccount,
    feeDestinationTokenAccount,
    protocolTreasuryTokenAccount,
  };

  // Conditionally include constraints PDA
  if (input.hasConstraints) {
    const [constraintsPda] = getConstraintsPDA(input.vault, program.programId);
    result.constraintsPda = constraintsPda;
  }

  // Include output stablecoin account if different from input
  if (input.outputMint && !input.outputMint.equals(input.tokenMint)) {
    result.outputStablecoinAccount = getAssociatedTokenAddressSync(
      input.outputMint,
      input.vault,
      true,
    );
  }

  return result;
}
