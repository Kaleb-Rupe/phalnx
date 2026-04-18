---
"@usesigil/kit": minor
---

**v0.12.0 — Sprint 2 finish: wire plugin runner + `onBeforeSign` hook into `seal()`.** Closes the two API-contract gaps from Sprint 2 (`@usesigil/kit@0.11.0`) where `SigilPolicyPlugin` and `SealHooks.onBeforeSign` were exported + documented but never actually invoked.

**What now works that didn't before:**

- **`SigilPolicyPlugin.check()` actually fires** — previously dead API. Plugins register via `SigilClientConfig.plugins` / `Sigil.quickstart({ plugins })` / `Sigil.fromVault({ plugins })` and run inside `seal()` after `resolveVaultState` + vault-active/agent-registered/agent-not-paused gates. First `{ allow: false }` short-circuits with `SigilSdkDomainError(SIGIL_ERROR__SDK__PLUGIN_REJECTED)`.

- **`SealHooks.onBeforeSign` actually fires** — previously unwired. Invoked once per seal, after transaction compose + size-check, before return. Same composed-hooks propagation as the other four hooks.

- **Three additional gaps closed in the same PR:**
  - `Sigil.quickstart` / `Sigil.fromVault` now forward `plugins` + `hooks` to the underlying `SigilClient.create()` (previously stored in `SigilVaultInternalState` but never reached the client).
  - `createSigilClient(config)` now calls `validatePluginList(config.plugins)` (previously only the facade path validated; direct factory path would fail lazily at first seal).
  - `PluginContext` gains a required `state` field (redacted snapshot — budget + vault status + agent capability — no owner pubkey, no agents roster, no vault_id; frozen via `Object.freeze`).

**Run order inside `seal()` (now documented correctly in `plugin.ts`):**

```
1. Parameter validation
2. onBeforeBuild hook (may abort via { skipSeal: true })
3. resolveVaultState (RPC)
4. Vault-active + agent-registered + agent-not-paused gates
5. Plugin checks (first { allow: false } throws)         ← NEW
6. Constraint check + transaction assembly
7. onBeforeSign hook (observe-only, pre-return)           ← NEW
```

Plugins run AFTER state resolution because 2 of 3 real use cases (rate limiting, compliance) need state input. Consumers wanting stateless early-exit use `onBeforeBuild` with `{ skipSeal: true, reason }` — that path still runs before any RPC.

**Breaking changes:** None to public API shape — `PluginContext.state` is additive. But any consumer who registered a `SigilPolicyPlugin` previously was getting silent no-op; now the plugin actually runs. If the plugin has bugs (e.g., always returns `{ allow: false }`), it will now reject real transactions. Re-test registered plugins end-to-end before upgrading.

**Security:**
- Plugin context state is **redacted** — no `owner`, no `agents[]`, no `vault_id`, no raw SpendTracker epochs
- Plugin context state is **frozen** (outer + nested) — mutation attempts throw in strict mode or silently discard in sloppy; neither is a working bypass
- Plugin throws are **not swallowed** (unlike observe-only hook throws) — treated as hard rejection with the error message preserved in the rejection reason

**Test delta:** +8 integration tests in `sdk/kit/tests/sprint2-hook-integration.test.ts` covering the 8 assertions from the plan (allow path, reject path, throw path, multi-plugin short-circuit, state visibility, no-plugins no-op, correlationId plumbing between `onBeforeBuild` and `onBeforeSign`). Kit total: 1453 → 1461.

**Migration:** No consumer code changes required. If you were registering plugins before, they'll now actually run — test first.
