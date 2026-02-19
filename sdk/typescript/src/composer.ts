import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  Connection,
} from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import type { AgentShield, ComposeActionParams } from "./types";
import {
  buildValidateAndAuthorize,
  buildFinalizeSession,
} from "./instructions";

/** Default compute budget for composed transactions (1.4M CU) */
const DEFAULT_COMPUTE_UNITS = 1_400_000;

/**
 * Build an atomic composed transaction:
 * [ComputeBudget, ValidateAndAuthorize, ...defiInstructions, FinalizeSession]
 *
 * All instructions succeed or all revert atomically.
 */
export async function composePermittedAction(
  program: Program<AgentShield>,
  params: ComposeActionParams,
  computeUnits: number = DEFAULT_COMPUTE_UNITS,
): Promise<TransactionInstruction[]> {
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: computeUnits,
  });

  const validateIx = await buildValidateAndAuthorize(
    program,
    params.agent,
    params.vault,
    params.vaultTokenAccount,
    {
      actionType: params.actionType,
      tokenMint: params.tokenMint,
      amount: params.amount,
      targetProtocol: params.targetProtocol,
      leverageBps: params.leverageBps,
    },
    params.oracleFeedAccount,
  ).instruction();

  const finalizeIx = await buildFinalizeSession(
    program,
    params.agent,
    params.vault,
    params.agent,
    params.tokenMint,
    params.success ?? true,
    params.vaultTokenAccount,
    params.feeDestinationTokenAccount,
    params.protocolTreasuryTokenAccount,
  ).instruction();

  return [computeBudgetIx, validateIx, ...params.defiInstructions, finalizeIx];
}

/**
 * Build and return a VersionedTransaction for a composed permitted action.
 * The transaction is NOT signed — caller must sign with the agent keypair.
 */
export async function composePermittedTransaction(
  program: Program<AgentShield>,
  connection: Connection,
  params: ComposeActionParams,
  computeUnits: number = DEFAULT_COMPUTE_UNITS,
): Promise<VersionedTransaction> {
  const instructions = await composePermittedAction(
    program,
    params,
    computeUnits,
  );
  const { blockhash } = await connection.getLatestBlockhash();

  const messageV0 = new TransactionMessage({
    payerKey: params.agent,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  return new VersionedTransaction(messageV0);
}

/**
 * Convenience: compose a swap action specifically.
 * Wraps composePermittedAction with actionType = { swap: {} }.
 */
export async function composePermittedSwap(
  program: Program<AgentShield>,
  params: Omit<ComposeActionParams, "actionType">,
  computeUnits: number = DEFAULT_COMPUTE_UNITS,
): Promise<TransactionInstruction[]> {
  return composePermittedAction(
    program,
    { ...params, actionType: { swap: {} } },
    computeUnits,
  );
}
