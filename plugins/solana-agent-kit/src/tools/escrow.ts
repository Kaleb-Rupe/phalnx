import { z } from "zod";
import type { ResolvedConfig } from "../types";

export const createEscrowSchema = z.object({
  destinationVault: z
    .string()
    .describe("Base58 public key of the destination vault"),
  amount: z.number().positive().describe("Amount in token base units"),
  tokenMint: z.string().describe("Base58 public key of the token mint"),
  durationSeconds: z
    .number()
    .int()
    .positive()
    .max(2_592_000)
    .describe("Escrow duration in seconds (max 30 days)"),
  conditionHash: z
    .string()
    .optional()
    .describe("Optional SHA-256 condition hash (hex string)"),
});

export const settleEscrowSchema = z.object({
  escrowAddress: z.string().describe("Base58 public key of the escrow PDA"),
  conditionProof: z
    .string()
    .optional()
    .describe("Optional preimage for SHA-256 condition (hex string)"),
});

export const refundEscrowSchema = z.object({
  escrowAddress: z.string().describe("Base58 public key of the escrow PDA"),
});

export const checkEscrowSchema = z.object({
  escrowAddress: z.string().describe("Base58 public key of the escrow PDA"),
});

export type CreateEscrowInput = z.infer<typeof createEscrowSchema>;
export type SettleEscrowInput = z.infer<typeof settleEscrowSchema>;
export type RefundEscrowInput = z.infer<typeof refundEscrowSchema>;
export type CheckEscrowInput = z.infer<typeof checkEscrowSchema>;

export async function createEscrow(
  _agent: any,
  config: ResolvedConfig,
  input: CreateEscrowInput,
): Promise<string> {
  const summary = config.wallet.getSpendingSummary();
  return [
    "Escrow Creation Request",
    `Destination: ${input.destinationVault}`,
    `Amount: ${input.amount}`,
    `Token: ${input.tokenMint}`,
    `Duration: ${input.durationSeconds}s`,
    input.conditionHash
      ? `Condition Hash: ${input.conditionHash}`
      : "Condition: None",
    `Wallet Status: ${summary.isPaused ? "PAUSED" : "ACTIVE"}`,
    "Note: Execute via SDK buildCreateEscrow() + composePermittedTransaction()",
  ].join("\n");
}

export async function settleEscrow(
  _agent: any,
  _config: ResolvedConfig,
  input: SettleEscrowInput,
): Promise<string> {
  return [
    "Escrow Settlement Request",
    `Escrow: ${input.escrowAddress}`,
    input.conditionProof
      ? `Condition Proof: ${input.conditionProof}`
      : "No condition proof",
    "Note: Execute via SDK buildSettleEscrow()",
  ].join("\n");
}

export async function refundEscrow(
  _agent: any,
  _config: ResolvedConfig,
  input: RefundEscrowInput,
): Promise<string> {
  return [
    "Escrow Refund Request",
    `Escrow: ${input.escrowAddress}`,
    "Note: Refund only available after escrow expiry. Execute via SDK buildRefundEscrow()",
  ].join("\n");
}

export async function checkEscrow(
  _agent: any,
  _config: ResolvedConfig,
  input: CheckEscrowInput,
): Promise<string> {
  return [
    "Escrow Status Check",
    `Escrow: ${input.escrowAddress}`,
    "Note: Use SDK fetchEscrow() or fetchEscrowByAddress() to query on-chain state.",
  ].join("\n");
}
