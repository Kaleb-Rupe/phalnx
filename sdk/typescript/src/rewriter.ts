import { PublicKey, TransactionInstruction } from "@solana/web3.js";

/**
 * Rewrite DeFi instructions so the vault PDA's signer role is replaced
 * by the agent (who holds delegated token authority).
 *
 * In production, DeFi protocols (Jupiter, Flash Trade) build instructions
 * with the vault PDA as `authority`. Since the vault PDA can't sign in
 * an outer transaction, we rewrite the authority to the agent — who has
 * been granted a token delegation via `validate_and_authorize`.
 *
 * Only signer keys matching `vaultPda` are rewritten; non-signer
 * references to the vault PDA are preserved.
 */
export function rewriteVaultAuthority(
  instructions: TransactionInstruction[],
  vaultPda: PublicKey,
  agent: PublicKey,
): TransactionInstruction[] {
  return instructions.map((ix) => ({
    ...ix,
    keys: ix.keys.map((key) =>
      key.pubkey.equals(vaultPda) && key.isSigner
        ? { ...key, pubkey: agent }
        : key,
    ),
  }));
}

/**
 * Validate that all signer references to the vault PDA have been
 * rewritten. Returns any instructions that still have the vault PDA
 * as a signer — should be empty after a successful rewrite.
 */
export function validateRewrite(
  instructions: TransactionInstruction[],
  vaultPda: PublicKey,
): TransactionInstruction[] {
  return instructions.filter((ix) =>
    ix.keys.some((key) => key.pubkey.equals(vaultPda) && key.isSigner),
  );
}
