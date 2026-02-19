import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN, Program } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import type {
  AgentShield,
  InitializeVaultParams,
  UpdatePolicyParams,
  QueuePolicyUpdateParams,
  AgentTransferParams,
  AuthorizeParams,
  ActionType,
} from "./types";
import {
  getVaultPDA,
  getPolicyPDA,
  getTrackerPDA,
  getSessionPDA,
  getPendingPolicyPDA,
} from "./accounts";

export function buildInitializeVault(
  program: Program<AgentShield>,
  owner: PublicKey,
  params: InitializeVaultParams,
) {
  const [vault] = getVaultPDA(owner, params.vaultId, program.programId);
  const [policy] = getPolicyPDA(vault, program.programId);
  const [tracker] = getTrackerPDA(vault, program.programId);

  return program.methods
    .initializeVault(
      params.vaultId,
      params.dailySpendingCapUsd,
      params.maxTransactionSizeUsd,
      params.allowedTokens as any,
      params.allowedProtocols,
      params.maxLeverageBps,
      params.maxConcurrentPositions,
      params.developerFeeRate ?? 0,
      params.timelockDuration ?? new BN(0),
      params.allowedDestinations ?? [],
    )
    .accounts({
      owner,
      vault,
      policy,
      tracker,
      feeDestination: params.feeDestination,
      systemProgram: SystemProgram.programId,
    } as any);
}

export function buildDepositFunds(
  program: Program<AgentShield>,
  owner: PublicKey,
  vault: PublicKey,
  mint: PublicKey,
  amount: BN,
) {
  const ownerTokenAccount = getAssociatedTokenAddressSync(mint, owner);
  const vaultTokenAccount = getAssociatedTokenAddressSync(mint, vault, true);

  return program.methods.depositFunds(amount).accounts({
    owner,
    vault,
    mint,
    ownerTokenAccount,
    vaultTokenAccount,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  } as any);
}

export function buildRegisterAgent(
  program: Program<AgentShield>,
  owner: PublicKey,
  vault: PublicKey,
  agent: PublicKey,
) {
  return program.methods.registerAgent(agent).accounts({
    owner,
    vault,
  } as any);
}

export function buildUpdatePolicy(
  program: Program<AgentShield>,
  owner: PublicKey,
  vault: PublicKey,
  params: UpdatePolicyParams,
) {
  const [policy] = getPolicyPDA(vault, program.programId);

  return program.methods
    .updatePolicy(
      params.dailySpendingCapUsd ?? null,
      params.maxTransactionSizeUsd ?? null,
      (params.allowedTokens as any) ?? null,
      params.allowedProtocols ?? null,
      params.maxLeverageBps ?? null,
      params.canOpenPositions ?? null,
      params.maxConcurrentPositions ?? null,
      params.developerFeeRate ?? null,
      params.timelockDuration ?? null,
      params.allowedDestinations ?? null,
    )
    .accounts({
      owner,
      vault,
      policy,
    } as any);
}

export function buildValidateAndAuthorize(
  program: Program<AgentShield>,
  agent: PublicKey,
  vault: PublicKey,
  vaultTokenAccount: PublicKey,
  params: AuthorizeParams,
  oracleFeedAccount?: PublicKey,
) {
  const [policy] = getPolicyPDA(vault, program.programId);
  const [tracker] = getTrackerPDA(vault, program.programId);
  const [session] = getSessionPDA(
    vault,
    agent,
    params.tokenMint,
    program.programId,
  );

  let builder = program.methods
    .validateAndAuthorize(
      params.actionType as any,
      params.tokenMint,
      params.amount,
      params.targetProtocol,
      params.leverageBps ?? null,
    )
    .accounts({
      agent,
      vault,
      policy,
      tracker,
      session,
      vaultTokenAccount,
      tokenMintAccount: params.tokenMint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as any);

  if (oracleFeedAccount) {
    builder = builder.remainingAccounts([
      { pubkey: oracleFeedAccount, isWritable: false, isSigner: false },
    ]);
  }

  return builder;
}

export function buildFinalizeSession(
  program: Program<AgentShield>,
  payer: PublicKey,
  vault: PublicKey,
  agent: PublicKey,
  tokenMint: PublicKey,
  success: boolean,
  vaultTokenAccount: PublicKey,
  feeDestinationTokenAccount?: PublicKey | null,
  protocolTreasuryTokenAccount?: PublicKey | null,
) {
  const [policy] = getPolicyPDA(vault, program.programId);
  const [tracker] = getTrackerPDA(vault, program.programId);
  const [session] = getSessionPDA(vault, agent, tokenMint, program.programId);

  return program.methods.finalizeSession(success).accounts({
    payer,
    vault,
    policy,
    tracker,
    session,
    sessionRentRecipient: agent,
    vaultTokenAccount,
    feeDestinationTokenAccount: feeDestinationTokenAccount ?? null,
    protocolTreasuryTokenAccount: protocolTreasuryTokenAccount ?? null,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  } as any);
}

export function buildRevokeAgent(
  program: Program<AgentShield>,
  owner: PublicKey,
  vault: PublicKey,
) {
  return program.methods.revokeAgent().accounts({
    owner,
    vault,
  } as any);
}

export function buildReactivateVault(
  program: Program<AgentShield>,
  owner: PublicKey,
  vault: PublicKey,
  newAgent?: PublicKey | null,
) {
  return program.methods.reactivateVault(newAgent ?? null).accounts({
    owner,
    vault,
  } as any);
}

export function buildWithdrawFunds(
  program: Program<AgentShield>,
  owner: PublicKey,
  vault: PublicKey,
  mint: PublicKey,
  amount: BN,
) {
  const vaultTokenAccount = getAssociatedTokenAddressSync(mint, vault, true);
  const ownerTokenAccount = getAssociatedTokenAddressSync(mint, owner);

  return program.methods.withdrawFunds(amount).accounts({
    owner,
    vault,
    mint,
    vaultTokenAccount,
    ownerTokenAccount,
    tokenProgram: TOKEN_PROGRAM_ID,
  } as any);
}

export function buildCloseVault(
  program: Program<AgentShield>,
  owner: PublicKey,
  vault: PublicKey,
) {
  const [policy] = getPolicyPDA(vault, program.programId);
  const [tracker] = getTrackerPDA(vault, program.programId);

  return program.methods.closeVault().accounts({
    owner,
    vault,
    policy,
    tracker,
    systemProgram: SystemProgram.programId,
  } as any);
}

export function buildQueuePolicyUpdate(
  program: Program<AgentShield>,
  owner: PublicKey,
  vault: PublicKey,
  params: QueuePolicyUpdateParams,
) {
  const [policy] = getPolicyPDA(vault, program.programId);
  const [pendingPolicy] = getPendingPolicyPDA(vault, program.programId);

  return program.methods
    .queuePolicyUpdate(
      params.dailySpendingCapUsd ?? null,
      params.maxTransactionAmountUsd ?? null,
      (params.allowedTokens as any) ?? null,
      params.allowedProtocols ?? null,
      params.maxLeverageBps ?? null,
      params.canOpenPositions ?? null,
      params.maxConcurrentPositions ?? null,
      params.developerFeeRate ?? null,
      params.timelockDuration ?? null,
      params.allowedDestinations ?? null,
    )
    .accounts({
      owner,
      vault,
      policy,
      pendingPolicy,
      systemProgram: SystemProgram.programId,
    } as any);
}

export function buildApplyPendingPolicy(
  program: Program<AgentShield>,
  owner: PublicKey,
  vault: PublicKey,
) {
  const [policy] = getPolicyPDA(vault, program.programId);
  const [pendingPolicy] = getPendingPolicyPDA(vault, program.programId);

  return program.methods.applyPendingPolicy().accounts({
    owner,
    vault,
    policy,
    pendingPolicy,
  } as any);
}

export function buildCancelPendingPolicy(
  program: Program<AgentShield>,
  owner: PublicKey,
  vault: PublicKey,
) {
  const [pendingPolicy] = getPendingPolicyPDA(vault, program.programId);

  return program.methods.cancelPendingPolicy().accounts({
    owner,
    vault,
    pendingPolicy,
  } as any);
}

export function buildAgentTransfer(
  program: Program<AgentShield>,
  agent: PublicKey,
  vault: PublicKey,
  params: AgentTransferParams,
  oracleFeedAccount?: PublicKey,
) {
  const [policy] = getPolicyPDA(vault, program.programId);
  const [tracker] = getTrackerPDA(vault, program.programId);

  let builder = program.methods
    .agentTransfer(params.amount)
    .accounts({
      agent,
      vault,
      policy,
      tracker,
      vaultTokenAccount: params.vaultTokenAccount,
      destinationTokenAccount: params.destinationTokenAccount,
      feeDestinationTokenAccount: params.feeDestinationTokenAccount ?? null,
      protocolTreasuryTokenAccount: params.protocolTreasuryTokenAccount ?? null,
      tokenProgram: TOKEN_PROGRAM_ID,
    } as any);

  if (oracleFeedAccount) {
    builder = builder.remainingAccounts([
      { pubkey: oracleFeedAccount, isWritable: false, isSigner: false },
    ]);
  }

  return builder;
}
