export { ShieldDeniedError, ShieldConfigError } from "@agent-shield/core";
export type { PolicyViolation } from "@agent-shield/core";

/**
 * Thrown when harden() or withVault() is called without a TEE wallet
 * and unsafeSkipTeeCheck is not set to true.
 */
export class TeeRequiredError extends Error {
  constructor() {
    super(
      "TEE wallet required. AgentShield requires a TEE-backed wallet (Crossmint, Turnkey, or Privy) " +
        "for production use. Pass a TeeWallet, set teeProvider in options, or set " +
        "unsafeSkipTeeCheck: true for devnet testing only.",
    );
    this.name = "TeeRequiredError";
  }
}
