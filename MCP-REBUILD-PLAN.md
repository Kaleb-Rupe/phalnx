# MCP Rebuild Plan — Extracted from Seal Architecture Plan v5

> **Status:** NOT STARTED — Deferred until SDK layer is complete and website is polished.
> **Prerequisites:** SDK `seal()` + `createVault()` battle-tested on devnet, website dashboard functional.
> **Extracted:** 2026-03-20 from `SEAL-ARCHITECTURE-PLAN-v5.md` Phase 3.

---

## MCP Design: ~15-20 tools, zero legacy

### MCP Integration Model

Sigil MCP is the **security layer**, not the instruction builder:

```
Agent Framework MCP (SAK, Jupiter, etc.)     Sigil MCP
           │                                      │
           ├── "Swap 10 USDC for SOL"             │
           ├── calls Jupiter API                  │
           ├── gets swap instructions              │
           │                                      │
           └── passes instructions ───────────────┤
                                                  ├── sigil_seal()
                                                  ├── adds validate + finalize
                                                  ├── returns composed TX
                                                  └── agent signs + sends
```

The new MCP server imports ONLY from `@usesigil/kit`. Zero `@usesigil/sdk`. Zero `@solana/web3.js`. Zero `@coral-xyz/anchor`.

> **SDK prerequisite:** MCP query tools (`check-vault`, `check-spending`) use Phase 6 analytics functions.
> Full analytics spec: `ANALYTICS-DATA-LAYER-PLAN.md` (42 functions across 8 modules).
> Key MCP dependencies: `getVaultSummary()`, `getSpendingBreakdown()`, `getVaultActivity()`, `getSecurityPosture()`, `formatUsd()`.

```
packages/mcp/
├── package.json          # deps: @modelcontextprotocol/sdk, @usesigil/kit, zod
├── src/
│   ├── index.ts          # Server setup, tool/resource registration
│   ├── config.ts         # RPC connection, signer setup
│   ├── errors.ts         # 70 error codes → human-readable (port from old, no new codes)
│   ├── utils.ts          # Address formatting, amount parsing
│   ├── tools/
│   │   ├── sigil-seal.ts       # THE tool — wrap pre-built instructions
│   │   ├── create-vault.ts      # Create vault + register agent + set policy
│   │   ├── check-vault.ts       # Read vault state (includes P&L via getVaultPnL)
│   │   ├── check-spending.ts    # Read spending tracker
│   │   ├── freeze-vault.ts      # Emergency freeze
│   │   ├── reactivate-vault.ts  # Unfreeze
│   │   ├── update-policy.ts     # Modify caps, allowlist, leverage
│   │   ├── register-agent.ts    # Add agent to vault
│   │   ├── revoke-agent.ts      # Remove agent
│   │   ├── pause-agent.ts       # Manual pause
│   │   ├── unpause-agent.ts     # Manual unpause
│   │   ├── deposit.ts           # Owner deposits funds
│   │   ├── withdraw.ts          # Owner withdraws funds
│   │   ├── create-constraints.ts # Set instruction constraints
│   │   ├── check-constraints.ts  # Read constraints
│   │   └── index.ts
│   ├── resources/
│   │   ├── vault-state.ts       # shield://vault/{address} (includes lifetime P&L from on-chain counters)
│   │   ├── spending.ts          # shield://spending/{address}
│   │   ├── protocols.ts         # shield://protocols (registry)
│   │   └── index.ts
│   ├── prompts/
│   │   ├── setup-vault.ts       # Guided vault creation
│   │   ├── safe-swap.ts         # Pre-flight checklist
│   │   ├── emergency.ts         # Incident response
│   │   └── index.ts
│   └── data/
│       └── protocol-registry.json
└── tests/
    └── (new tests for each tool)
```

**15 tools** (sigil-wrap + 12 vault management + create-constraints + check-constraints)

**Constraint builder note:** The constraints MODULE (sdk/kit/src/constraints/) is deleted in Phase 0. The MCP `create-constraints` tool uses the Codama-generated `getCreateInstructionConstraintsInstruction()` directly, accepting raw byte-level constraint config (program ID, discriminator bytes, field offsets, operators, values).

**No `learn-protocol` tool needed.** Under outcome-based spending detection, unknown protocols work automatically — spending is measured by balance delta, not discriminator classification. The protocol just needs to be on the vault's allowlist.

**3 resources** (vault state, spending, protocol registry)
**3 prompts** (setup, safe-swap, emergency)

### sigil_seal tool schema

```typescript
z.object({
  vault: z.string().describe("Vault PDA address (base58)"),
  instructions: z.array(z.object({
    programId: z.string(),
    accounts: z.array(z.object({
      pubkey: z.string(),
      isSigner: z.boolean(),
      isWritable: z.boolean(),
    })),
    data: z.string().describe("base64"),
  })),
  tokenMint: z.string(),
  amount: z.string().optional(),
  actionType: z.string().optional(),
  leverageBps: z.number().optional(),
})
```

### Protocol registry

```json
[
  { "name": "Jupiter V6", "programId": "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", "category": "swap" },
  { "name": "Flash Trade", "programId": "FLASH6Lo6h3iasJKWDs2F8TkW2UKf3s15C8PMGuVfgBn", "category": "perps" },
  { "name": "Kamino Lending", "programId": "KLend2g3cP87ber8CzRaqeECGwNvLFM9acPVcRkRHvM", "category": "lending" },
  { "name": "Drift V2", "programId": "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH", "category": "perps" },
  { "name": "Raydium AMM", "programId": "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", "category": "swap" },
  { "name": "Orca Whirlpool", "programId": "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", "category": "swap" },
  { "name": "Meteora DLMM", "programId": "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", "category": "swap" },
  { "name": "Marginfi V2", "programId": "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA", "category": "lending" }
]
```

### Jupiter/token API helpers for MCP

The new MCP needs Jupiter price and token data. Create them fresh in the MCP package (pure HTTP, zero blockchain deps):

```
packages/mcp/src/apis/
├── jupiter-price.ts    # getJupiterPrices() — ~40 lines, calls api.jup.ag/price/v2
├── jupiter-tokens.ts   # searchJupiterTokens(), getTrendingTokens(), isTokenSuspicious() — ~80 lines
└── jupiter-lend.ts     # getJupiterLendTokens() — ~50 lines, calls api.jup.ag/lend
```

These live in the MCP package, NOT in @usesigil/kit — they are distribution-layer concerns, not security SDK concerns.

### MCP structured error format

The sigil_seal tool should return structured errors for AI agent recovery:

```typescript
{
  error: {
    code: 6006,
    what: "Spending cap exceeded",
    why: "Rolling 24h spend is $450 of $500 cap. This $100 transaction would exceed.",
    remaining_usd: 50,
    alternatives: [
      "Reduce amount to $50 or less",
      "Wait for cap to roll off (oldest spend expires in 2h 15m)",
      "Ask vault owner to increase cap"
    ]
  }
}
```

### Tests

```bash
pnpm --filter @usesigil/mcp test
```

All new MCP tests pass. Manual test: start MCP server, call `sigil_seal` tool → returns composed TX.

---

## Cedar Policy Engine — Future Implementation (Post-MVP)

> **Status:** PLANNED — Implement after core MCP tools are functional and at least one integration partner or devnet user requests richer policy controls than on-chain InstructionConstraints provide.
> **Prerequisites:** Core MCP tools working (sigil_seal + vault management), devnet E2E validated.
> **Estimated effort:** ~10-12 days on top of MCP build (~4-5 weeks combined).

### Why Cedar, Why MCP

Cedar is Amazon's open-source authorization policy language (Apache-2.0). It's formally verified via Dafny, not Turing-complete (always terminates), and uses a deny-overrides model. AWS Bedrock AgentCore uses Cedar for AI agent authorization (GA March 2026).

The MCP server is the correct integration point because:
1. **Node.js only** — 4 MB WASM binary is irrelevant server-side, avoids polluting `@usesigil/kit` for browser users
2. **Richest context** — MCP tool inputs (vault, amount, actionType, tokenMint) map directly to Cedar's principal/action/resource/context model
3. **Natural checkpoint** — every agent action enters through an MCP tool
4. **Graceful degradation** — if Cedar is bypassed, on-chain InstructionConstraints + finalize_session still enforce trustlessly

### Three-Layer Enforcement Model

```
┌─ LAYER 1: Cedar (MCP server) ─────────────────────────┐
│ Rich: &&/||, groups, time windows, blocklists, presets │
│ Trust: MCP server operator                             │
│ Bypass: agent calls RPC directly → Layer 2 catches     │
├─ LAYER 2: InstructionConstraints (on-chain) ───────────┤
│ Minimal: 7 ops, 16 entries, byte-level matching        │
│ Trust: Solana runtime (trustless)                      │
│ Bypass: impossible — program rejects                   │
├─ LAYER 3: finalize_session (on-chain) ─────────────────┤
│ Outcome: actual balance delta verification             │
│ Trust: Solana runtime (trustless)                      │
│ Bypass: impossible — program rejects                   │
└────────────────────────────────────────────────────────┘
```

### Package & API

- **npm:** `@cedar-policy/cedar-wasm` v4.9.1 (23 versions, Amazon-maintained, zero dependencies)
- **WASM binary:** 4.0 MB raw / 1.33 MB gzipped (3 build targets: ESM, Node.js CJS, Web)
- **Key function:** `isAuthorized(call: AuthorizationCall): AuthorizationAnswer`
- **Performance path:** `statefulIsAuthorized()` with `preparsePolicySet()` / `preparseSchema()` for cached repeated evaluations
- **No fork needed:** Cedar's `Long` (i64, max ~$9.2B in microdollars) covers Sigil's stablecoin u64 amounts. Unlike Shield3/Banyan (EVM, needs u256), Sigil does not require a Cedar fork.

### What Cedar Expresses That On-Chain Constraints Cannot

| Capability | Cedar (MCP) | InstructionConstraints (on-chain) |
|------------|-------------|-----------------------------------|
| Compound boolean logic | Full `&&`/`||`/`!`/`if-then-else` | Implicit AND within entry, OR across entries |
| Group membership / blocklists | `resource in Group::"sanctioned"` | Per-pubkey AccountConstraint (max 5) |
| Time-window restrictions | Datetime/duration types | None |
| External data (sanctions, ML scores) | Via entities + context | None (purely instruction data) |
| Conditional thresholds | `if token == USDC then max 10K else max 1K` | Separate entries, no cross-field conditions |
| Human-readable policies | Cedar text syntax | Byte offsets and discriminators |
| Schema validation | Compile-time type checking | Structural validation only |

### MCP Directory Additions

```
packages/mcp/src/
├── policy/                          # Cedar policy engine
│   ├── engine.ts                    # CedarPolicyEngine class (wraps WASM)
│   ├── schema.ts                    # Sigil Cedar schema (Agent, Vault, Protocol, Action entities)
│   ├── mapper.ts                    # Maps MCP tool inputs → Cedar AuthorizationCall
│   ├── defaults.ts                  # Default policy presets
│   └── types.ts                     # TypeScript types for policy decisions
├── middleware/
│   └── policy-guard.ts              # Pre-tool Cedar evaluation middleware
├── tools/
│   └── manage-policies.ts           # NEW tool: load/switch/validate Cedar policies
├── resources/
│   └── vault-policies.ts            # NEW resource: shield://vault/{address}/policies
```

### Tool Call Flow (with Cedar)

```
Agent calls sigil_seal({vault, instructions, tokenMint, amount, actionType})
    │
    ▼
1. policy-guard.ts middleware
   ├─ Maps inputs → Cedar AuthorizationCall
   │   principal: Agent::"<agent_pubkey>"
   │   action:    Action::"Swap"
   │   resource:  Vault::"<vault_pda>"
   │   context:   { amount_usd: 5000000000, protocol: "Jupiter", token_mint: "USDC..." }
   ├─ Calls statefulIsAuthorized() (~microseconds, cached schema+policies)
   ├─ If DENY → return structured error with policy name + reason
   └─ If ALLOW → continue to tool handler
    │
    ▼
2. sigil-seal.ts tool handler (unchanged)
   ├─ Calls sdk.seal(instructions)
   └─ Returns composed TX
    │
    ▼
3. On-chain enforcement (unchanged, trustless backstop)
   ├─ validate_and_authorize: InstructionConstraints byte-level check
   ├─ DeFi instruction executes
   └─ finalize_session: balance delta verification
```

### Cedar Policy Examples for Sigil

```cedar
// Conservative preset — $500/day, Jupiter swaps only
permit(
    principal is Agent,
    action == Action::"Swap",
    resource is Vault
) when {
    context.amount_usd < 500000000 &&
    context.protocol == "Jupiter"
};

// Block all perps for this vault
forbid(
    principal is Agent,
    action in [Action::"OpenPosition", Action::"IncreasePosition"],
    resource == Vault::"<vault_pda>"
);

// Business hours only (deny-overrides — this forbid always wins)
forbid(
    principal is Agent,
    action,
    resource is Vault
) when {
    context.hour < 9 || context.hour > 17
};

// Global default — deny everything not explicitly permitted
forbid(principal, action, resource);
```

### Policy Storage (v1)

File-based, co-located with MCP server config:
```
~/.sigil/policies/
├── vault-<address>.cedar           # Per-vault policies
├── global.cedar                    # Global defaults (deny-by-default)
└── presets/
    ├── conservative.cedar          # $500/day, Jupiter only
    ├── moderate.cedar              # $5K/day, all DeFi, no perps
    └── aggressive.cedar            # $50K/day, all protocols
```

Phase 4+: policies move to on-chain storage or IPFS with Merkle root verification.

### Competitive Context

- **Shield3** uses Banyan (Cedar fork + u256) as an EVM RPC proxy — same architectural pattern, different chain. EVM-only, no Solana.
- **Privy/Stripe** has calldata-level Solana policy evaluation — closest competitor, but off-chain (TEE-enforced, bypassable by bypassing API).
- **MCPay** uses a hook-based proxy pattern with payment policy evaluation — validated that MCP middleware works.
- **AWS Bedrock AgentCore** uses Cedar for AI agent authorization (GA March 2026) — direct precedent.
- **No one combines Cedar + on-chain instruction constraints on Solana.** This would be a first.

### Work Estimate (Added to MCP Build)

| Item | Days | Phase |
|------|------|-------|
| `CedarPolicyEngine` class + WASM init | 2 | Build alongside `index.ts` |
| Sigil Cedar schema (6 entity types) | 2 | Build alongside tool definitions |
| `policy-guard.ts` middleware + mapper | 2 | Build alongside sigil-wrap tool |
| 3 preset policies | 1 | Build alongside create-vault tool |
| `manage-policies` tool + `vault-policies` resource | 2 | Tool #16 + Resource #4 |
| Tests (schema validation, policy eval, integration) | 2-3 | Alongside each component |
| **Total** | **~10-12 days** | |

### Confidence: 90%

- Package is mature (23 versions, Amazon-maintained, zero deps)
- `statefulIsAuthorized()` built for repeated evaluations (our exact use case)
- No fork needed (Long covers stablecoin u64)
- Graceful degradation (on-chain enforces if Cedar bypassed)
- MCPay + AWS Bedrock AgentCore validate the pattern

---

## MCP E2E Validation (part of Devnet E2E)

- MCP `sigil_seal` tool end-to-end
- Start MCP server → call sigil_seal → verify composed TX matches seal() output
- Constraint builder (create constraints → agent violates → rejected)

### Full test suite (when MCP is built)

```bash
pnpm --filter @usesigil/mcp test
```

---

## REST API Layer (Persona-Validated, 2026-03-22)

> **Source:** 7-persona walkthrough. 4 of 7 personas (Raj, Chen, Alex, Diego) independently requested programmatic API access. The dashboard is browser-only — no REST endpoints, no CLI, no headless access.
> **Architecture:** Vercel API routes (Next.js App Router) deployed alongside the dashboard. Read-only endpoints backed by `@usesigil/kit` SDK functions. No database required for v1 — all data from RPC.

### API Design: Read-Only Vault + Protocol Endpoints

**Base URL:** `https://app.sigil.io/api/v1`

All endpoints are public (read-only on-chain data). No authentication required. Rate-limited via Vercel Edge middleware (100 req/min per IP).

```
apps/dashboard/src/app/api/v1/
├── vault/
│   ├── [address]/
│   │   ├── route.ts              # GET — resolveVaultState()
│   │   ├── pnl/route.ts          # GET — getVaultPnL() (lifetime P&L from on-chain counters)
│   │   ├── history/route.ts      # GET — getSpendingHistory() (24h from SpendTracker)
│   │   ├── events/route.ts       # GET — decoded events from Helius Enhanced TX API
│   │   ├── balances/route.ts     # GET — getVaultTokenBalances()
│   │   └── agents/route.ts       # GET — agent list with budgets
├── owner/
│   └── [address]/
│       └── vaults/route.ts       # GET — findVaultsByOwner()
├── protocol/
│   └── [programId]/
│       └── stats/route.ts        # GET — cross-vault protocol aggregation
└── health/route.ts               # GET — API health check
```

### Endpoint Specifications

#### `GET /api/v1/vault/{address}`
Returns full vault state including policy, agents, budgets, and constraints.
```json
{
  "vault": { "status": "Active", "owner": "...", "agents": [...], "totalVolume": "1234000000" },
  "policy": { "dailySpendingCapUsd": "500000000", "protocolMode": 1, ... },
  "globalBudget": { "spent24h": "123000000", "cap": "500000000", "remaining": "377000000" },
  "agentBudgets": [{ "agent": "...", "spent24h": "...", "cap": "...", "remaining": "..." }],
  "securityChecklist": { "noFullPermissions": true, "capConfigured": true, ... }
}
```

#### `GET /api/v1/vault/{address}/history?hours=24`
Returns SpendTracker epoch buckets as time-series.
```json
{
  "epochs": [
    { "timestamp": 1711036800, "usdAmount": "15000000" },
    { "timestamp": 1711037400, "usdAmount": "22000000" }
  ],
  "resolution": "10min",
  "totalBuckets": 144
}
```

#### `GET /api/v1/vault/{address}/events?limit=50`
Returns decoded Sigil events from recent transactions.
```json
{
  "events": [
    {
      "name": "ActionAuthorized",
      "fields": { "agent": "...", "actionType": "Swap", "amount": "50000000", "protocol": "JUP6..." },
      "txSignature": "...",
      "blockTime": 1711036800
    }
  ]
}
```

#### `GET /api/v1/owner/{address}/vaults`
Returns all vault addresses for an owner.
```json
{
  "owner": "...",
  "vaults": ["vault1...", "vault2...", "vault3..."],
  "count": 3
}
```

#### `GET /api/v1/protocol/{programId}/stats` (Serves: Alex)

Cross-vault aggregation for protocol partners. **This is the feature Alex's persona identified as completely missing** — Section 2 listed "Protocol Team" as a persona but delivered zero features for them.

**Implementation:**
1. Calls `getProgramAccounts` with `PolicyConfig` filter for vaults that include `programId` in their protocol allowlist
2. For each matching vault, reads SpendTracker and filters for protocol-specific spending
3. Returns aggregate metrics

```json
{
  "programId": "FLASH6Lo6h3iasJKWDs2F8TkW2UKf3s15C8PMGuVfgBn",
  "protocolName": "Flash Trade",
  "stats": {
    "vaultCount": 47,
    "agentCount": 112,
    "volume24h": "2450000000000",
    "volume7d": "15200000000000",
    "feesGenerated24h": "490000000"
  }
}
```

**Note:** This endpoint is expensive (scans many vaults). Cache results for 5 minutes via Vercel Edge caching. For Phase 4+, switch to PostgreSQL-backed aggregation.

**Indexer schema addition (Phase 4):** Add `protocol` column to `spending_hourly` and `spending_daily` tables for efficient cross-vault protocol queries.

```sql
ALTER TABLE spending_hourly ADD COLUMN protocol TEXT;
ALTER TABLE spending_daily ADD COLUMN protocol TEXT;
CREATE INDEX idx_hourly_protocol ON spending_hourly (protocol, hour DESC);
```

### Embeddable Widget (Serves: Alex) — Phase 4+

Protocol partners want a badge for their own websites showing Sigil-secured volume.

```
GET /api/v1/protocol/{programId}/badge
→ Returns SVG badge: "Protected by Sigil — $2.4M volume secured"
```

Implementation: Vercel Edge Function that generates an SVG with live stats from the protocol stats endpoint. Cacheable, embeddable via `<img>` tag.

---

## Notification Relay Service (Persona-Validated)

> **Source:** Marcus and Sarah both need push notifications for CRITICAL alerts when the dashboard tab is closed.

### Telegram Bot Relay — Phase 4

**Architecture:** Helius webhook → Vercel Edge Function → Telegram Bot API

**Implementation:**
1. Create Telegram bot via @BotFather → get bot token
2. MCP tool: `sigil_configure_alerts` — links vault address to Telegram chat ID
3. Store mapping in Supabase (Phase 4 database): `vault_address → telegram_chat_id`
4. Helius webhook fires on vault PDA changes → Edge Function decodes event → evaluates alert triggers → sends Telegram message
5. Message format:
```
ALERT: Vault drain detected
Vault: 7Kp3...xQ2m
Spent: $1,200 in 40 minutes (240% velocity)

Tap to freeze: https://app.sigil.io/vault/7Kp3.../freeze
```

**MCP tool schema:**
```typescript
// New tool: configure-alerts.ts
z.object({
  vault: z.string().describe("Vault PDA address"),
  channel: z.enum(["telegram", "discord", "webhook"]),
  destination: z.string().describe("Chat ID, channel ID, or webhook URL"),
  severity: z.enum(["all", "warning", "critical"]).default("critical"),
})
```

### Quick-Freeze Deep Link

Alert notifications include `https://app.sigil.io/vault/{address}/freeze` — a dedicated page that:
1. Shows vault status + recent activity summary
2. Pre-builds `freezeVault` instruction
3. Shows `TransactionPreview`
4. Owner signs → vault frozen → confirmation

This reduces emergency response from 5 clicks to 1 click from the notification.

---

## CLI Parity (Serves: Diego, Raj) — Phase 4+

For power users who monitor via terminal scripts:

```
packages/cli/
├── package.json          # deps: @usesigil/kit, commander
├── src/
│   ├── index.ts          # CLI entry point
│   ├── commands/
│   │   ├── vault-status.ts    # sigil vault-status <address>
│   │   ├── vault-list.ts      # sigil vault-list <owner>
│   │   ├── spending.ts        # sigil spending <address> [--24h|--7d]
│   │   ├── freeze.ts          # sigil freeze <address> (interactive sign)
│   │   └── export.ts          # sigil export <address> --format=json|csv
```

Uses the same `@usesigil/kit` functions as the dashboard. Outputs JSON by default, human-readable with `--pretty`.

This satisfies Diego's need for CLI monitoring alongside the dashboard, and Chen's need for scriptable audit queries.

---

## Persona Test Findings (2026-03-24) — Elena, AI Agent Developer

> **Source:** 6-persona readiness assessment. Elena (SAK/MCP developer) and Marcus (bot developer) provided MCP-relevant findings.

**Revised Status (2026-03-24):** SDK prerequisites MET. MCP build can start. SAK plugin needs transfer implementation + 4 more action types.

### Finding 1: MCP Server Does Not Exist (BLOCKING)

- `packages/mcp/` directory is empty
- The 15-tool plan above is comprehensive and the SDK functions they depend on all exist
- Elena said: "There is no MCP server to connect to. For Claude/ChatGPT agent developer today: nothing works."
- **PRIORITY:** This is the #1 blocker for AI agent adoption

### Finding 2: SAK Plugin Gaps

- `sigil_transfer` is a stub returning `{success: false, error: "not yet implemented"}`
- Only 3 of 21 ActionTypes covered (swap, transfer-stub, status)
- Missing: perps actions (open/close position), lending (deposit/withdraw), escrow
- Elena's give-up threshold: "3 of 21 ActionTypes is not a security layer, it's a demo"

### Finding 3: No Transparent Wrapping (Architectural Decision Needed)

- The SAK plugin exposes PARALLEL methods (`sigil_swap`) not middleware interception
- An AI agent's system prompt must explicitly reference `sigil_swap` instead of `swap`
- If the agent framework calls SAK's native `swap()`, Sigil is NOT in the path
- Options: (A) Keep parallel methods (current), (B) Build SAK middleware interceptor
- **Recommendation:** Keep parallel for now, document clearly, revisit when SAK supports middleware hooks

### Finding 4: SAK Plugin Not Published to npm (BLOCKING)

- `@usesigil/plugin-solana-agent-kit` at 0.1.0 in monorepo but not on npm
- External developers cannot install it
- Blocked by: npm publish pipeline (same as SDK P0)

### Finding 5: Zero Documentation

- No README in the plugin package
- No getting-started guide for MCP or SAK integration
- The only "documentation" is `plugin.test.ts` and code comments
- Elena: "Most developers stop at the point of needing to read 300+ lines of source code"

### Finding 6: MCP SDK Dependencies Verified

- All 15 planned MCP tools depend on SDK functions that NOW EXIST:
  - `sigil_seal` -> `seal()` / `SigilClient.executeAndConfirm()`
  - `check-vault` -> `getVaultSummary()`, `resolveVaultStateForOwner()`
  - `check-spending` -> `getSpendingBreakdown()`, `getSpendingVelocity()`
  - `freeze-vault` -> `buildOwnerTransaction()` + `getFreezeVaultInstruction()`
  - etc.
- The SDK prerequisite mentioned at the top of this plan IS MET
- MCP build can start NOW
