/**
 * safe-swap prompt — Pre-flight checklist for executing a swap through Phalnx.
 *
 * Ensures the agent validates permissions, checks spending capacity,
 * and confirms token addresses before executing.
 */

import { z } from "zod";

export const safeSwapArgsSchema = {
  inputToken: z.string().describe("Input token symbol or mint address"),
  outputToken: z.string().describe("Output token symbol or mint address"),
  amount: z
    .string()
    .describe("Amount in token-native units (e.g. '1000000' for 1 USDC)"),
  slippageBps: z
    .number()
    .optional()
    .describe("Max slippage in basis points (default: policy max)"),
};

export interface SafeSwapArgs {
  inputToken: string;
  outputToken: string;
  amount: string;
  slippageBps?: number;
}

export function safeSwapPrompt(args: SafeSwapArgs) {
  return {
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: JSON.stringify(
            {
              workflow: "safe-swap",
              params: {
                inputToken: args.inputToken,
                outputToken: args.outputToken,
                amount: args.amount,
                slippageBps: args.slippageBps ?? null,
              },
              steps: [
                {
                  step: 1,
                  tool: "phalnx_advise",
                  input: { question: "whatCanIDo" },
                  purpose: "Verify agent has 'swap' permission",
                  check: "allowedActions must include 'swap'",
                  onFailure: "STOP — agent lacks swap permission",
                },
                {
                  step: 2,
                  tool: "phalnx_query",
                  input: {
                    query: "searchTokens",
                    params: { query: args.inputToken },
                  },
                  purpose: "Resolve input token to verified mint address",
                  check: "Token exists and is not suspicious",
                },
                {
                  step: 3,
                  tool: "phalnx_query",
                  input: {
                    query: "searchTokens",
                    params: { query: args.outputToken },
                  },
                  purpose: "Resolve output token to verified mint address",
                  check: "Token exists and is not suspicious",
                },
                {
                  step: 4,
                  tool: "phalnx_query",
                  input: { query: "spending" },
                  purpose: "Check remaining spending capacity",
                  check:
                    "remainingCapUsd >= swap amount. If not, STOP — would exceed daily cap",
                },
                {
                  step: 5,
                  tool: "phalnx_query",
                  input: { query: "policy" },
                  purpose: "Verify slippage within policy limits",
                  check: `slippageBps (${args.slippageBps ?? "default"}) <= maxSlippageBps`,
                },
                {
                  step: 6,
                  tool: "phalnx_execute",
                  input: {
                    action: "swap",
                    params: {
                      inputToken: args.inputToken,
                      outputToken: args.outputToken,
                      amount: args.amount,
                      ...(args.slippageBps
                        ? { slippageBps: args.slippageBps }
                        : {}),
                    },
                  },
                  purpose: "Execute the swap through Phalnx guardrails",
                  onFailure: {
                    tool: "phalnx_advise",
                    input: {
                      question: "whyDidThisFail",
                      context: { errorCode: "FROM_ERROR" },
                    },
                  },
                },
              ],
              safetyChecks: [
                "Agent has swap permission",
                "Both tokens resolved to valid mints",
                "Spending cap has sufficient headroom",
                "Slippage within policy bounds",
              ],
            },
            null,
            2,
          ),
        },
      },
    ],
  };
}
