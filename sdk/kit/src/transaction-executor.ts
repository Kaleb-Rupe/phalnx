/**
 * TransactionExecutor — Pipeline steps 9-12 for Kit SDK.
 *
 * Separated from IntentEngine for clean separation of concerns:
 * IntentEngine handles orchestration (steps 1-8),
 * TransactionExecutor handles network I/O (steps 9-12).
 *
 * Steps:
 *   9. Compose versioned transaction (blockhash + compile)
 *  10. Simulate (fail-closed)
 *  11. Sign
 *  12. Send + confirm, parse events
 */

import type {
  Address,
  Instruction,
  Rpc,
  SolanaRpcApi,
  TransactionSigner,
} from "@solana/kit";
import { getBase64EncodedWireTransaction } from "@solana/kit";

import { composePhalnxTransaction } from "./composer.js";
import {
  simulateBeforeSend,
  adjustCU,
  type SimulationResult,
} from "./simulation.js";
import { parsePhalnxEvents, type PhalnxEvent } from "./events.js";
import {
  BlockhashCache,
  sendAndConfirmTransaction,
  type SendAndConfirmOptions,
} from "./rpc-helpers.js";
import { estimateComposedCU } from "./priority-fees.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ExecuteTransactionParams {
  /** Fee payer address (typically the agent) */
  feePayer: Address;
  /** The validate_and_authorize instruction */
  validateIx: Instruction;
  /** DeFi protocol instruction(s) to sandwich */
  defiInstructions: Instruction[];
  /** The finalize_session instruction */
  finalizeIx: Instruction;
  /** Optional: override CU limit */
  computeUnits?: number;
  /** Optional: priority fee in microLamports per CU */
  priorityFeeMicroLamports?: number;
  /** Skip simulation (default: false — simulation is fail-closed) */
  skipSimulation?: boolean;
}

export interface ExecuteTransactionResult {
  /** Transaction signature (base58) */
  signature: string;
  /** Compute units consumed (from simulation) */
  unitsConsumed?: number;
  /** Transaction logs */
  logs?: string[];
  /** Parsed Phalnx events */
  events: PhalnxEvent[];
}

export interface TransactionExecutorOptions {
  /** Blockhash cache TTL in milliseconds */
  blockhashCacheTtlMs?: number;
  /** Send+confirm options */
  confirmOptions?: SendAndConfirmOptions;
}

// ─── TransactionExecutor ────────────────────────────────────────────────────

export class TransactionExecutor {
  readonly rpc: Rpc<SolanaRpcApi>;
  readonly agent: TransactionSigner;
  private readonly blockhashCache: BlockhashCache;
  private readonly confirmOptions: SendAndConfirmOptions;

  constructor(
    rpc: Rpc<SolanaRpcApi>,
    agent: TransactionSigner,
    options?: TransactionExecutorOptions,
  ) {
    this.rpc = rpc;
    this.agent = agent;
    this.blockhashCache = new BlockhashCache(options?.blockhashCacheTtlMs);
    this.confirmOptions = options?.confirmOptions ?? {};
  }

  /**
   * Step 9: Compose a versioned transaction from instructions + cached blockhash.
   */
  async composeTransaction(params: ExecuteTransactionParams) {
    const blockhash = await this.blockhashCache.get(this.rpc);

    const computeUnits =
      params.computeUnits ?? estimateComposedCU(params.defiInstructions);

    const compiledTx = composePhalnxTransaction({
      feePayer: params.feePayer,
      validateIx: params.validateIx,
      defiInstructions: params.defiInstructions,
      finalizeIx: params.finalizeIx,
      blockhash,
      computeUnits,
      priorityFeeMicroLamports: params.priorityFeeMicroLamports,
    });

    return { compiledTx, computeUnits, blockhash };
  }

  /**
   * Step 10: Simulate the transaction. Fail-closed — failure blocks sending.
   * If CU consumed differs >20% from estimate, re-composes.
   */
  async simulate(
    params: ExecuteTransactionParams,
    compiledTx: ReturnType<typeof composePhalnxTransaction>,
    estimatedCU: number,
    blockhash: { blockhash: string; lastValidBlockHeight: bigint },
  ): Promise<{
    simulation: SimulationResult;
    recomposedTx?: ReturnType<typeof composePhalnxTransaction>;
    finalCU: number;
  }> {
    const wireBase64 = getBase64EncodedWireTransaction(compiledTx);
    const simulation = await simulateBeforeSend(this.rpc, wireBase64);

    if (!simulation.success) {
      return { simulation, finalCU: estimatedCU };
    }

    // Check if CU adjustment is needed
    const adjustedCU = adjustCU(estimatedCU, simulation.unitsConsumed);
    if (adjustedCU !== estimatedCU) {
      // Re-compose with adjusted CU — reuse blockhash from initial compose
      const recomposedTx = composePhalnxTransaction({
        feePayer: params.feePayer,
        validateIx: params.validateIx,
        defiInstructions: params.defiInstructions,
        finalizeIx: params.finalizeIx,
        blockhash,
        computeUnits: adjustedCU,
        priorityFeeMicroLamports: params.priorityFeeMicroLamports,
      });
      return { simulation, recomposedTx, finalCU: adjustedCU };
    }

    return { simulation, finalCU: estimatedCU };
  }

  /**
   * Steps 11+12: Sign, send, and confirm the transaction.
   */
  async signSendConfirm(
    compiledTx: ReturnType<typeof composePhalnxTransaction>,
  ): Promise<{ signature: string; logs?: string[] }> {
    // Sign using Kit's TransactionSigner interface.
    // TransactionSigner is a union type — use the available signing method.
    const signer = this.agent as any;
    const signFn = signer.modifyAndSignTransactions ?? signer.signTransactions;
    if (!signFn) {
      throw new Error("Agent signer does not implement a signing method");
    }
    const [signedTx] = await signFn.call(signer, [compiledTx]);
    const wireBase64 = getBase64EncodedWireTransaction(signedTx as any);

    const signature = await sendAndConfirmTransaction(
      this.rpc,
      wireBase64,
      this.confirmOptions,
    );

    return { signature };
  }

  /**
   * Full pipeline: compose → simulate → sign → send → parse events.
   * Steps 9-12 in one call.
   */
  async executeTransaction(
    params: ExecuteTransactionParams,
  ): Promise<ExecuteTransactionResult> {
    // Step 9: Compose
    const { compiledTx, computeUnits, blockhash } =
      await this.composeTransaction(params);

    // Step 10: Simulate (unless skipped)
    let txToSign = compiledTx;
    let simLogs: string[] | undefined;
    let unitsConsumed: number | undefined;

    if (!params.skipSimulation) {
      const { simulation, recomposedTx } = await this.simulate(
        params,
        compiledTx,
        computeUnits,
        blockhash,
      );

      if (!simulation.success) {
        const errMsg = simulation.error?.suggestion
          ?? simulation.error?.message
          ?? "Simulation failed";
        throw new Error(`Simulation failed: ${errMsg}`);
      }

      simLogs = simulation.logs;
      unitsConsumed = simulation.unitsConsumed;
      if (recomposedTx) {
        txToSign = recomposedTx;
      }
    }

    // Steps 11+12: Sign, send, confirm
    const { signature } = await this.signSendConfirm(txToSign);

    // Parse events from simulation logs (best-effort)
    const events = simLogs ? parsePhalnxEvents(simLogs) : [];

    return {
      signature,
      unitsConsumed,
      logs: simLogs,
      events,
    };
  }
}
