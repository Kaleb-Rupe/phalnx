import {
  shieldWallet,
  withVault,
  type ShieldedWallet,
  type WalletLike,
  type ShieldPolicies,
  type ShieldOptions,
  type HardenOptions,
  type HardenResult,
} from "@phalnx/sdk";

export interface FactoryConfig {
  /** Raw wallet to wrap with shieldWallet(). */
  wallet: WalletLike;
  /** Shield policies (string shorthand or full config). */
  policies?: ShieldPolicies;
  /** Optional logger for shield event callbacks. */
  logger?: {
    info?: (...args: any[]) => void;
    warn?: (...args: any[]) => void;
  };
  /** Additional ShieldOptions (storage, custom callbacks). */
  options?: ShieldOptions;
}

/** Config for createOnChainVault — extends FactoryConfig with harden options. */
export interface OnChainVaultConfig extends FactoryConfig {
  /** Harden options (connection, ownerWallet, etc.). */
  hardenOptions: HardenOptions;
}

/** Config for createSAKAgentWithShield — full agent setup. */
export interface SAKAgentConfig extends OnChainVaultConfig {
  /** Solana RPC URL for the SolanaAgentKit. */
  rpcUrl: string;
  /** Optional SolanaAgentKit config object. */
  agentConfig?: Record<string, any>;
}

/** Wires logger callbacks into ShieldOptions. */
function wireCallbacks(config: FactoryConfig): ShieldOptions {
  const log = config.logger ?? console;
  const info = log.info ?? console.info;
  const warn = log.warn ?? console.warn;

  return {
    ...config.options,
    onDenied: (error) => {
      warn("[Phalnx] Transaction denied:", error.message);
      config.options?.onDenied?.(error);
    },
    onApproved: (txHash) => {
      info("[Phalnx] Transaction approved", txHash ?? "");
      config.options?.onApproved?.(txHash);
    },
    onPause: () => {
      info("[Phalnx] Enforcement paused");
      config.options?.onPause?.();
    },
    onResume: () => {
      info("[Phalnx] Enforcement resumed");
      config.options?.onResume?.();
    },
    onPolicyUpdate: (policies) => {
      info("[Phalnx] Policies updated");
      config.options?.onPolicyUpdate?.(policies);
    },
  };
}

/**
 * Create a client-side-only ShieldedWallet (no on-chain vault).
 * Fast, synchronous, zero network calls.
 *
 * @example
 * ```ts
 * const wallet = createClientSideWallet({
 *   wallet: keypairWallet,
 *   policies: { maxSpend: '500 USDC/day' },
 *   logger: console,
 * });
 * ```
 */
export function createClientSideWallet(config: FactoryConfig): ShieldedWallet {
  return shieldWallet(config.wallet, config.policies, wireCallbacks(config));
}

/**
 * Create a fully hardened on-chain vault wallet.
 * Async — creates vault + registers agent on-chain.
 *
 * @example
 * ```ts
 * const result = await createOnChainVault({
 *   wallet: teeWallet,
 *   policies: { maxSpend: '500 USDC/day' },
 *   logger: console,
 *   hardenOptions: { connection, unsafeSkipTeeCheck: true },
 * });
 * // result.wallet has dual enforcement
 * ```
 */
export async function createOnChainVault(
  config: OnChainVaultConfig,
): Promise<HardenResult> {
  return withVault(config.wallet, config.policies, config.hardenOptions);
}

/**
 * Full agent setup: create ShieldedWallet + SolanaAgentKit in one call.
 * Requires `solana-agent-kit` to be installed.
 *
 * @example
 * ```ts
 * const { agent, wallet, vaultAddress } = await createSAKAgentWithShield({
 *   wallet: teeWallet,
 *   policies: { maxSpend: '500 USDC/day' },
 *   rpcUrl: 'https://api.devnet.solana.com',
 *   hardenOptions: { connection, unsafeSkipTeeCheck: true },
 * });
 * ```
 */
export async function createSAKAgentWithShield(
  config: SAKAgentConfig,
): Promise<HardenResult & { agent: any }> {
  const result = await createOnChainVault(config);

  // Dynamic import to avoid hard dependency on solana-agent-kit
  const { SolanaAgentKit } = await import("solana-agent-kit");
  const agent = new SolanaAgentKit(
    result.wallet as any,
    config.rpcUrl,
    config.agentConfig ?? {},
  );

  return { ...result, agent };
}

/**
 * @deprecated Use `createClientSideWallet()` for client-side only,
 * or `createOnChainVault()` for full on-chain enforcement.
 */
export function createShieldedWallet(config: FactoryConfig): ShieldedWallet {
  return createClientSideWallet(config);
}
