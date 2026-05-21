# @usesigil/kit — Migration Guide

This file collects breaking-change recipes for every major SDK transition.
Newest first.

---

## 0.15.x → 0.16.0 (Phase 9 SDK redesign)

### Removed: protocol-tier classifier + protocol-registry annotations

The `protocol-tier.ts` and `protocol-registry/` modules and their six
re-exports are gone. The dashboard already uses its own local
`@/lib/protocol-registry/` and the private `@sigil-trade/constraints`
package; nothing inside `agent-middleware/` consumed the kit copies.

```diff
- import {
-   resolveProtocolTier,
-   PROTOCOL_ANNOTATIONS,
-   VERIFIED_PROGRAMS,
-   lookupProtocolAnnotation,
-   ProtocolAnnotation,
-   ProtocolTrustTier,
- } from "@usesigil/kit";

+ // Dashboard: use the local lib + the private constraints package.
+ import { PROTOCOL_ANNOTATIONS, VERIFIED_PROGRAMS } from "@/lib/protocol-registry";
+ import { lookupProtocolAnnotation } from "@sigil-trade/constraints";
```

The unrelated `ProtocolTier` enum on `protocol-resolver.ts` (vault
allowlist tier — KNOWN / DEFAULT / NOT_ALLOWED) is preserved and used
internally by `seal.ts`.

### Renamed: `OwnerClient.resumeVault` → `OwnerClient.reactivateVault`

The original method stays as a back-compat alias; new code should call
`reactivateVault` to match the on-chain `reactivate_vault` instruction
name.

```diff
- await client.resumeVault({ address: agent, permissions: 2 });
+ await client.reactivateVault({ address: agent, permissions: 2 });
```

No semantic change; same on-chain instruction.

### Coming in v1.0: `requireMainnetConfirmation` default flip

0.16.0 introduces the `requireMainnetConfirmation` option on
`SigilClientConfig` but defaults it to `false` for back-compat. When
unset on a mainnet client, the SDK emits a `console.warn` referencing
this migration entry.

**v1.0 will flip the default to `true`** — mainnet `executeAndConfirm`
calls without an explicit `mainnetConfirmed: true` will throw error
7020 (`MAINNET_CONFIRMATION_REQUIRED`).

Prepare for the flip now:

```diff
const client = createSigilClient({
  rpc,
  vault,
  agent,
  network: "mainnet",
+ requireMainnetConfirmation: true, // adopt the v1.0 default early
});

await client.executeAndConfirm(ixs, {
  tokenMint: USDC_MAINNET,
  amount: 500_000_000n,
+ mainnetConfirmed: true, // explicit per-call opt-in
});
```

If you cannot adopt the v1.0 default yet, explicitly set
`requireMainnetConfirmation: false` to silence the warning until you
are ready.

---

## Earlier transitions

See git log + per-release `CHANGELOG.md` entries for transitions older
than 0.15.0.
