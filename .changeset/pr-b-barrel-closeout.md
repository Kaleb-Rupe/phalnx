---
"@usesigil/kit": minor
---

**v0.13.0 — Sprint 1 barrel closeout.** Removes 54 internal utilities from the root barrel of `@usesigil/kit` per the zero-consumer audit. Pre-1.0, no external consumers — verified repo-wide before the audit.

**What's hidden from `@usesigil/kit` root** (source files remain; reachable only by relative imports inside the SDK):

- **Internal RPC plumbing (15):** `BlockhashCache`, `getBlockhashCache`, `AltCache`, `mergeAltAddresses`, `SIGIL_ALT_DEVNET`, `SIGIL_ALT_MAINNET`, `getSigilAltAddress`, `signAndEncode`, `sendAndConfirmTransaction`, `composeSigilTransaction`, `validateTransactionSize`, `measureTransactionSize`, `toInstruction`, `bytesToAddress`, `resolveAccounts` — plus types `ComposeTransactionParams`, `Blockhash`, `SendAndConfirmOptions`, `ResolveAccountsInput`, `ResolvedAccounts`.

- **Policy engine internals (10):** `evaluatePolicy`, `enforcePolicy`, `recordTransaction`, `toCoreAnalysis`, `ShieldStorage`, `SpendEntry`, `TxEntry`, `VelocityTracker`, `VelocityConfig`, `SpendStatus`. Consumers use `shield()` and `vault.budget()` instead.

- **TEE internal plumbing (10):** `AttestationCache`, `DEFAULT_CACHE_TTL_MS`, `clearAttestationCache`, `deleteFromAttestationCache`, `WalletLike`, `AttestationConfig`, `AttestationLevel`, `AttestationMetadata`, `NitroPcrValues`, `TurnkeyAttestationBundle`. Consumers use `verifyTurnkey()` / `verifyTeeAttestation()`.

- **Redundant vault creation (8):** `inscribe`, `withVault`, `mapPoliciesToVaultParams`, `findNextVaultId` + their types. Consumers use `createAndSendVault` / `createVault`.

- **Internal constants (10):** `EPOCH_DURATION`, `NUM_EPOCHS`, `OVERLAY_EPOCH_DURATION`, `OVERLAY_NUM_EPOCHS`, `ROLLING_WINDOW_SECONDS`, `PROTOCOL_TREASURY`, `PROTOCOL_FEE_RATE`, `MAX_DEVELOPER_FEE_RATE`, `FEE_RATE_DENOMINATOR`, `ON_CHAIN_ERROR_MAP`. `toAgentError()` replaces the error map; others are internal implementation detail.

- **Duplicate TransactionExecutor (4):** `TransactionExecutor`, `ExecuteTransactionParams`, `ExecuteTransactionResult`, `TransactionExecutorOptions`. Consumers use `createSigilClient().executeAndConfirm()`.

**Migrated (not hidden): `custodyAdapterToTransactionSigner` + `CustodyAdapter`.** Moved from `@usesigil/kit` to `packages/plugins/src/sak/signer.ts` where its only consumer lives. `sdk/kit/src/custody-adapter.ts` source file deleted. Custody-adapter unit tests (8) moved with it to `packages/plugins/tests/custody-signer.test.ts`.

**Preserved:** All Sprint 1 + Sprint 2 public surface stays — `Sigil` facade, `SigilVault`, `createSigilClient`, `createSigilClientAsync`, `SigilClient` (deprecated but still exported, private-ctor guarded), `SealHooks`, `SigilPolicyPlugin`, `parseUsd`, `initializeVaultAtas`, `VAULT_PRESETS`, `SAFETY_PRESETS`, account decoders, public TEE verification (`verifyTurnkey` etc.), `shield()`, `toAgentError()`, and the `/react`, `/errors`, `/dashboard`, `/x402`, `/testing`, `/testing/devnet` subpaths.

**Surface size:** 388 → ~334 root exports (−54). Further cuts (generated account decoder sprawl — `decodeX`, `fetchAllX`, `fetchMaybeX`, `getXCodec`/`Encoder`/`Size`) are the remaining gap to the ≤125 plan target; they carry dashboard build-verification risk and land in a future "generated surface trim" PR.

**Migration guide for consumers (none exist pre-1.0, documented for 1.0 readiness):**

```diff
- import { BlockhashCache, AltCache } from "@usesigil/kit";
+ // These are now private. Use createSigilClient() — it manages caches
+ // internally. Call client.invalidateCaches() to reset.

- import { evaluatePolicy } from "@usesigil/kit";
+ import { shield } from "@usesigil/kit";

- import { ON_CHAIN_ERROR_MAP, parseOnChainErrorCode } from "@usesigil/kit";
+ import { toAgentError } from "@usesigil/kit";
+ // Handles on-chain and SDK errors uniformly.

- import { inscribe } from "@usesigil/kit";
+ import { createAndSendVault } from "@usesigil/kit";

- import { TransactionExecutor } from "@usesigil/kit";
+ import { createSigilClient } from "@usesigil/kit";
+ const client = createSigilClient(config);
+ await client.executeAndConfirm(instructions, opts);

- import { custodyAdapterToTransactionSigner } from "@usesigil/kit";
+ import { custodyAdapterToTransactionSigner } from "@usesigil/plugins/sak";
+ // Bridge helper moved to the plugin that actually uses it.
```

**No `@usesigil/plugins` changeset.** The SAK plugin's `custodyAdapterToTransactionSigner` import site moves from `@usesigil/kit` to a local `./signer.js`; zero public API change for plugin consumers. 8 unit tests moved with the helper (`@usesigil/plugins` test count: 6 → 14).
