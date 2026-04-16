---
"@usesigil/kit": minor
---

Branded types + type consolidation (PR 2.B).

**BREAKING:**

- `addAgent()`, `queueAgentPermissions()`, `CreateVaultOptions` — `permissions` parameter is now `CapabilityTier` (was `bigint`). Use `capability(2n)` instead of `2n`.
- `CreateVaultOptions` USD fields (`dailySpendingCapUsd`, `maxTransactionSizeUsd`, `spendingLimitUsd`) are now `UsdBaseUnits` (was `bigint`). Use `usd(500_000_000n)` instead of `500_000_000n`.
- `DiscoveredVault` renamed to `VaultLocator`. Deprecated alias preserved for one minor.
- New peer dependency: `@solana/errors@^6.2.0`.

**New exports:**

- `UsdBaseUnits`, `CapabilityTier`, `Slot` — branded bigint types (zero runtime cost)
- `usd()`, `capability()`, `slot()` — constructor helpers
- `VaultLocator` — renamed from `DiscoveredVault`

**Migration:**

```ts
import { usd, capability } from "@usesigil/kit";

// Before: addAgent(vault, owner, "devnet", agent, 2n, 500_000_000n)
// After:
addAgent(vault, owner, "devnet", agent, capability(2n), usd(500_000_000n));
```
