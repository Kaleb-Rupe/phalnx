import {
  shieldWallet,
  type ShieldedWallet,
  type WalletLike,
  type ShieldPolicies,
  type ShieldOptions,
} from "@agent-shield/sdk";

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

/**
 * Convenience factory that creates a ShieldedWallet from a raw wallet.
 * Auto-wires event callbacks to the provided logger.
 *
 * @example
 * ```ts
 * const wallet = createShieldedWallet({
 *   wallet: keypairWallet,
 *   policies: { maxSpend: '500 USDC/day' },
 *   logger: console,
 * });
 * ```
 */
export function createShieldedWallet(config: FactoryConfig): ShieldedWallet {
  const log = config.logger ?? console;
  const info = log.info ?? console.info;
  const warn = log.warn ?? console.warn;

  const options: ShieldOptions = {
    ...config.options,
    onDenied: (error) => {
      warn("[AgentShield] Transaction denied:", error.message);
      config.options?.onDenied?.(error);
    },
    onApproved: (txHash) => {
      info("[AgentShield] Transaction approved", txHash ?? "");
      config.options?.onApproved?.(txHash);
    },
    onPause: () => {
      info("[AgentShield] Enforcement paused");
      config.options?.onPause?.();
    },
    onResume: () => {
      info("[AgentShield] Enforcement resumed");
      config.options?.onResume?.();
    },
    onPolicyUpdate: (policies) => {
      info("[AgentShield] Policies updated");
      config.options?.onPolicyUpdate?.(policies);
    },
  };

  return shieldWallet(config.wallet, config.policies, options);
}
