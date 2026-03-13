/**
 * Jupiter Handler — Kit-native T1 Protocol Handler
 *
 * Pure HTTP-based Jupiter swap integration. No web3.js dependency.
 * Deserializes Jupiter's serialized instructions into Kit Instruction format,
 * then sandwiches them with validate_and_authorize + finalize_session.
 */

import type { Address, Instruction } from "@solana/kit";
import { AccountRole } from "@solana/kit";
import type {
  ProtocolHandler,
  ProtocolHandlerMetadata,
  ProtocolComposeResult,
  ProtocolContext,
} from "./protocol-handler.js";
import {
  jupiterFetch,
  JupiterApiError,
} from "./jupiter-api.js";
import { JUPITER_PROGRAM_ADDRESS } from "../types.js";
import { ActionType } from "../generated/types/actionType.js";

// Re-export for convenience
export { JupiterApiError };

// ─── Types ──────────────────────────────────────────────────────────────────

export interface JupiterQuoteParams {
  inputMint: Address;
  outputMint: Address;
  amount: bigint;
  slippageBps?: number;
  extraParams?: Record<string, string>;
}

export interface JupiterRoutePlanStep {
  swapInfo: {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount: string;
    feeMint: string;
  };
  percent: number;
}

export interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: JupiterRoutePlanStep[];
  contextSlot: number;
  timeTaken: number;
}

export interface JupiterSerializedInstruction {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string; // base64
}

export interface JupiterSwapInstructionsResponse {
  tokenLedgerInstruction?: JupiterSerializedInstruction;
  computeBudgetInstructions: JupiterSerializedInstruction[];
  setupInstructions: JupiterSerializedInstruction[];
  swapInstruction: JupiterSerializedInstruction;
  cleanupInstruction?: JupiterSerializedInstruction;
  addressLookupTableAddresses: string[];
}

// ─── Deserialization ────────────────────────────────────────────────────────

/**
 * Deserialize a Jupiter serialized instruction into a Kit Instruction.
 */
export function deserializeJupiterInstruction(
  ix: JupiterSerializedInstruction,
): Instruction {
  return {
    programAddress: ix.programId as Address,
    accounts: ix.accounts.map((acc) => ({
      address: acc.pubkey as Address,
      role: acc.isSigner && acc.isWritable
        ? AccountRole.WRITABLE_SIGNER
        : acc.isSigner
          ? AccountRole.READONLY_SIGNER
          : acc.isWritable
            ? AccountRole.WRITABLE
            : AccountRole.READONLY,
    })),
    data: base64ToUint8Array(ix.data),
  };
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ─── API Functions ──────────────────────────────────────────────────────────

export async function fetchJupiterQuote(
  params: JupiterQuoteParams,
): Promise<JupiterQuoteResponse> {
  const slippage = params.slippageBps ?? 50;
  const qs = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount.toString(),
    slippageBps: slippage.toString(),
    ...params.extraParams,
  });

  const response = await jupiterFetch<JupiterQuoteResponse>(`/v6/quote?${qs.toString()}`, {
    timeoutMs: 5_000,
  });

  if (
    !response ||
    typeof response.inputMint !== "string" ||
    typeof response.outputMint !== "string" ||
    typeof response.inAmount !== "string" ||
    typeof response.outAmount !== "string" ||
    !Array.isArray(response.routePlan)
  ) {
    throw new JupiterApiError(
      0,
      "Invalid Jupiter quote response: missing required fields (inputMint, outputMint, inAmount, outAmount, routePlan)",
    );
  }

  return response;
}

export async function fetchJupiterSwapInstructions(
  quote: JupiterQuoteResponse,
  userPublicKey: Address,
): Promise<JupiterSwapInstructionsResponse> {
  const response = await jupiterFetch<JupiterSwapInstructionsResponse>(
    "/v6/swap-instructions",
    {
      method: "POST",
      body: {
        quoteResponse: quote,
        userPublicKey,
        wrapAndUnwrapSol: true,
      },
    },
  );

  if (
    !response ||
    !response.swapInstruction ||
    typeof response.swapInstruction.programId !== "string" ||
    !Array.isArray(response.computeBudgetInstructions) ||
    !Array.isArray(response.setupInstructions) ||
    !Array.isArray(response.addressLookupTableAddresses)
  ) {
    throw new JupiterApiError(
      0,
      "Invalid Jupiter swap-instructions response: missing required fields (swapInstruction, computeBudgetInstructions, setupInstructions, addressLookupTableAddresses)",
    );
  }

  return response;
}

// ─── Jupiter Protocol Handler ───────────────────────────────────────────────

const JUPITER_HANDLER_METADATA: ProtocolHandlerMetadata = {
  protocolId: "jupiter",
  displayName: "Jupiter",
  programIds: [JUPITER_PROGRAM_ADDRESS],
  supportedActions: new Map([
    ["swap", { actionType: ActionType.Swap, isSpending: true }],
  ]),
};

/**
 * Kit-native Jupiter T1 handler.
 *
 * compose() fetches a Jupiter quote and swap instructions,
 * deserializes them to Kit Instructions, and returns them
 * for sandwiching in a Phalnx composed transaction.
 */
export class JupiterHandler implements ProtocolHandler {
  readonly metadata = JUPITER_HANDLER_METADATA;

  async compose(
    ctx: ProtocolContext,
    action: string,
    params: Record<string, unknown>,
  ): Promise<ProtocolComposeResult> {
    if (action !== "swap") {
      throw new Error(`Jupiter handler does not support action: ${action}`);
    }

    const inputMint = params.inputMint as Address;
    const outputMint = params.outputMint as Address;
    const amount = typeof params.amount === "bigint"
      ? params.amount
      : BigInt(params.amount as string);
    const slippageBps = params.slippageBps as number | undefined;
    const preQuote = params.quote as JupiterQuoteResponse | undefined;

    // 1. Get quote
    const quote = preQuote ?? await fetchJupiterQuote({
      inputMint,
      outputMint,
      amount,
      slippageBps,
    });

    // 2. Get swap instructions from Jupiter with vault as the user
    const swapResponse = await fetchJupiterSwapInstructions(quote, ctx.vault);

    // 3. Deserialize to Kit Instructions
    const instructions: Instruction[] = [];

    for (const ix of swapResponse.setupInstructions) {
      instructions.push(deserializeJupiterInstruction(ix));
    }
    instructions.push(deserializeJupiterInstruction(swapResponse.swapInstruction));
    if (swapResponse.cleanupInstruction) {
      instructions.push(deserializeJupiterInstruction(swapResponse.cleanupInstruction));
    }

    return {
      instructions,
      addressLookupTables: swapResponse.addressLookupTableAddresses as Address[],
    };
  }

  summarize(action: string, params: Record<string, unknown>): string {
    if (action === "swap") {
      return `Swap ${params.amount} of ${params.inputMint} -> ${params.outputMint} via Jupiter`;
    }
    return `Jupiter: ${action}`;
  }
}

/** Singleton instance for registration */
export const jupiterHandler = new JupiterHandler();
