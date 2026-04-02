# Protocol Integration Guide

> **DEPRECATED (2026-03-20):** This guide describes the old protocol-specific integration model (IntentEngine, per-protocol handlers, MCP tools). That architecture was removed in Phase 0.
> The current architecture uses protocol-agnostic `seal()` — see `SEAL-ARCHITECTURE-PLAN-v5.md`.
> Sigil no longer builds protocol integrations. Agent frameworks (SAK, GOAT, Eliza) build instructions; Sigil wraps them.

Reference for adding new DeFi protocols to the Sigil SDK (pre-seal architecture, preserved for reference).

---

## Architecture Overview

Sigil separates concerns into three layers:

| Layer | What It Does | What It Knows About Protocols |
|-------|-------------|-------------------------------|
| **On-Chain (Rust)** | Enforces guardrails — caps, permissions, fees, delegation, instruction scanning | Almost nothing. Protocol-agnostic. Only exception: Jupiter V6 slippage verifier (variable-length route plans can't use generic constraints). |
| **SDK (TypeScript)** | Builds transactions — composes validate→DeFi→finalize atomically | Everything. Knows how to build instructions for each protocol, resolve accounts, fetch quotes. |
| **MCP (Tools)** | AI agent interface — exposes tools with Zod schemas | Surfaces SDK capabilities as LLM-friendly tools with descriptions and validation. |

**The on-chain program never needs to change when adding a new protocol.** All protocol-specific work happens in the SDK and MCP layers.

---

## On-Chain Constraint System (What the Program Enforces)

### How It Works

When a vault has constraints configured, the on-chain program scans every instruction in the transaction and checks them against byte-level rules. Think of it as a firewall for instruction data.

### Capacity Limits (Hard-Coded)

| Limit | Value | What It Means |
|-------|-------|---------------|
| **Max constraint entries per vault** | **16** | Total rules across ALL protocols. Budget carefully. |
| Max data constraints per entry | 8 | Up to 8 byte-level checks per rule (AND-ed together) |
| Max account constraints per entry | 5 | Up to 5 "account at index X must be Y" checks per rule |
| Max constraint value length | 32 bytes | Enough for u256, pubkeys, or any field up to 32 bytes |

### Logic Model

```
Entry 1 (Flash Trade): discriminator == openPosition AND leverage <= 10x AND market == SOL-PERP
Entry 2 (Flash Trade): discriminator == closePosition
Entry 3 (Drift):       discriminator == placePerpOrder AND leverage <= 20x

Within an entry:  AND (all checks must pass)
Across entries for same program: OR (any passing entry allows the instruction)
```

### strict_mode

- **false** (default): Programs without matching entries are allowed through. Only programs WITH entries get checked.
- **true**: Programs without matching entries are BLOCKED. Every non-infrastructure program must have a matching rule.

### Entry Budget Planning

Each unique (protocol + instruction variant + market) combination costs 1 entry.

**Example budget for a 5-protocol vault:**

```
Flash Trade openPosition (SOL, max 10x)    → Entry 1
Flash Trade openPosition (ETH, max 5x)     → Entry 2
Flash Trade closePosition (any)             → Entry 3
Drift placePerpOrder (SOL, max 20x)         → Entry 4
Drift placePerpOrder (ETH, max 10x)         → Entry 5
Drift cancelOrder (any)                     → Entry 6
Kamino deposit (USDC pool)                  → Entry 7
Kamino withdraw (USDC pool)                 → Entry 8
Orca swap (USDC/SOL pool only)              → Entry 9
Jupiter handled by slippage verifier        → (no entry needed)
─────────────────────────────────────────────
Total: 9 of 16 used, 7 remaining
```

**If you exceed 16:** Move fine-grained per-market rules to SDK-side pre-validation. Keep on-chain constraints for the most critical guardrails (leverage caps, pool restrictions).

### Leverage: Two-Level System

1. **Policy-level** (`max_leverage_bps` on PolicyConfig): Global cap for ALL protocols. Always enforced.
2. **Constraint-level** (data constraint with Lte operator): Per-protocol or per-market cap. Additive to policy cap.

The lower limit always wins. Set the policy cap as your safety ceiling, then use constraints for tighter per-protocol rules.

### 7 Constraint Operators

| Operator | What It Checks | Use Case |
|----------|---------------|----------|
| **Eq** | Bytes at offset exactly equal value | Require specific instruction discriminator, specific market ID |
| **Ne** | Bytes at offset NOT equal value | Block a specific instruction variant |
| **Gte** | Unsigned integer at offset >= value | Minimum amount threshold |
| **Lte** | Unsigned integer at offset <= value | Maximum leverage, maximum amount cap |
| **GteSigned** | Signed integer at offset >= value | Minimum PnL (can be negative) |
| **LteSigned** | Signed integer at offset <= value | Maximum loss allowed |
| **Bitmask** | All mask bits set in actual value | Require specific flags enabled |

All comparisons use little-endian byte ordering (standard for Solana/Borsh).

---

## SDK Integration Layers (6 Layers)

Adding a new protocol requires work across 6 layers. Each layer has a clear responsibility.

### Layer 1: Intent Mapping

**File:** `sdk/kit/src/intents.ts`
**Action:** Modify — add intent types + ACTION_TYPE_MAP entries

Map each protocol action to an on-chain ActionType and spending classification.

```typescript
// Add to IntentAction union type:
| { type: "marginfiDeposit"; params: { tokenMint: string; amount: string } }
| { type: "marginfiWithdraw"; params: { tokenMint: string; amount: string } }
| { type: "marginfiBorrow"; params: { tokenMint: string; amount: string } }
| { type: "marginfiRepay"; params: { tokenMint: string; amount: string } }

// Add to ACTION_TYPE_MAP:
marginfiDeposit:  { actionType: ActionType.Deposit,  isSpending: true },
marginfiWithdraw: { actionType: ActionType.Withdraw, isSpending: false },
marginfiBorrow:   { actionType: ActionType.Withdraw, isSpending: false },
marginfiRepay:    { actionType: ActionType.Deposit,  isSpending: true },
```

**Rules:**
- One intent name → one ActionType. No many-to-many.
- `isSpending: true` = consumes vault balance (swap, deposit, open position, add collateral, create escrow)
- `isSpending: false` = reduces risk (close, withdraw, cancel, remove collateral)

**The 21 on-chain ActionTypes (choose the closest match):**

| ActionType | Bit | Spending | When to Use |
|-----------|-----|----------|-------------|
| Swap | 0 | Yes | Token swaps (AMMs, DEX aggregators) |
| OpenPosition | 1 | Yes | Open leveraged/perp position |
| ClosePosition | 2 | No | Close position |
| IncreasePosition | 3 | Yes | Add to existing position |
| DecreasePosition | 4 | No | Partially close position |
| Deposit | 5 | Yes | Lending deposits, liquidity provision |
| Withdraw | 6 | No | Lending withdrawals, LP removal |
| Transfer | 7 | Yes | Stablecoin transfer to allowed destination |
| AddCollateral | 8 | Yes | Add collateral to position |
| RemoveCollateral | 9 | No | Remove collateral from position |
| PlaceTriggerOrder | 10 | No | Place stop-loss / take-profit |
| EditTriggerOrder | 11 | No | Modify trigger order |
| CancelTriggerOrder | 12 | No | Cancel trigger order |
| PlaceLimitOrder | 13 | Yes | Place limit order (locks funds) |
| EditLimitOrder | 14 | No | Modify limit order |
| CancelLimitOrder | 15 | No | Cancel limit order (releases funds) |
| SwapAndOpenPosition | 16 | Yes | Atomic swap + open position |
| CloseAndSwapPosition | 17 | No | Atomic close + swap out |
| CreateEscrow | 18 | Yes | Create escrow deposit |
| SettleEscrow | 19 | No | Settle escrow |
| RefundEscrow | 20 | No | Refund expired escrow |

---

### Layer 2: Protocol Handler

**File:** `sdk/kit/src/integrations/t2-handlers.ts`
**Action:** Modify — add handler class + metadata + singleton export

```typescript
const MARGINFI_METADATA: ProtocolHandlerMetadata = {
  protocolId: "marginfi",
  displayName: "Marginfi Lending",
  programIds: [MARGINFI_PROGRAM],
  supportedActions: new Map([
    ["deposit",  { actionType: ActionType.Deposit,  isSpending: true }],
    ["withdraw", { actionType: ActionType.Withdraw, isSpending: false }],
    ["borrow",   { actionType: ActionType.Withdraw, isSpending: false }],
    ["repay",    { actionType: ActionType.Deposit,  isSpending: true }],
  ]),
};

export class MarginfiHandler implements ProtocolHandler {
  readonly metadata = MARGINFI_METADATA;

  async compose(ctx: ProtocolContext, action: string, params: Record<string, unknown>): Promise<ProtocolComposeResult> {
    return dispatchMarginfiCompose(ctx, action, params);
  }

  summarize(action: string, params: Record<string, unknown>): string {
    return `Marginfi ${action} ${params.amount ?? ""} ${params.tokenMint ?? ""}`;
  }
}

export const marginfiHandler = new MarginfiHandler();
```

**ProtocolContext contains:** vault address, owner, vaultId, agent, network, rpc

**compose() must return:** `{ instructions: Instruction[], additionalSigners?: TransactionSigner[], addressLookupTables?: AddressLookupTable[] }`

---

### Layer 3: Compose Dispatcher

**File:** `sdk/kit/src/integrations/{protocol}-compose.ts` (NEW file)
**Action:** Create

This is where protocol-specific transaction building happens. One async function per action, plus a dispatcher.

```typescript
import { getDepositInstruction } from "../generated/protocols/marginfi/instructions/deposit.js";
import { resolveMarginfiAccounts } from "./config/marginfi-markets.js";

async function composeDeposit(ctx: ProtocolContext, params: Record<string, unknown>): Promise<ProtocolComposeResult> {
  const tokenMint = requireField<string>(params, "tokenMint");
  const amount = requireField<string>(params, "amount");
  const accts = resolveMarginfiAccounts(tokenMint);

  const ix = getDepositInstruction({
    owner: addressAsSigner(ctx.vault),
    feePayer: addressAsSigner(ctx.agent),
    bank: accts.bank,
    depositAmount: BigInt(amount),
    // ... all accounts from config
  });

  return { instructions: [ix as Instruction] };
}

// One function per action...

export async function dispatchMarginfiCompose(
  ctx: ProtocolContext, action: string, params: Record<string, unknown>
): Promise<ProtocolComposeResult> {
  switch (action) {
    case "deposit":  return composeDeposit(ctx, params);
    case "withdraw": return composeWithdraw(ctx, params);
    case "borrow":   return composeBorrow(ctx, params);
    case "repay":    return composeRepay(ctx, params);
    default: throw new Error(`Unsupported Marginfi action: ${action}`);
  }
}
```

**Three dependency patterns:**

| Pattern | Used By | How It Works |
|---------|---------|-------------|
| **Codama-generated** (preferred) | Flash Trade, Kamino | Import generated instruction builders. Zero runtime dependency. |
| **SDK with dynamic import** | Drift | `const sdk = await import("@drift-labs/sdk")`. Optional dep, lazy init. |
| **Compat bridge** | Legacy protocols | Import old SDK, convert web3.js Instructions to Kit Instructions. |

**Always prefer Codama** — it produces zero-dependency, stateless instruction builders.

---

### Layer 4: Static Account Config

**File:** `sdk/kit/src/integrations/config/{protocol}-markets.ts` (NEW file)
**Action:** Create

Hardcoded program IDs, PDAs, market configs, oracle addresses. This replaces fetching from on-chain at runtime.

```typescript
export const MARGINFI_PROGRAM = "MFv2hWf31Z9kbCCcq3flVQE5Uj8peKPFF7B8oNQeZL8" as Address;
export const MARGINFI_GROUP = "4qp6Fx6tnZkY5Wropq9wUYgtFxXKwE6viZxFHg3rdAG8" as Address;

export interface MarginfiReserveConfig {
  bank: Address;
  mint: Address;
  liquidityVault: Address;
  feeVault: Address;
  oracle: Address;
  decimals: number;
}

export const MARGINFI_RESERVE_MAP: Record<string, MarginfiReserveConfig> = {
  USDC: {
    bank: "..." as Address,
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address,
    // ... all addresses
  },
  SOL: { /* ... */ },
};

export function resolveMarginfiAccounts(tokenSymbol: string): MarginfiReserveConfig {
  const reserve = MARGINFI_RESERVE_MAP[tokenSymbol];
  if (!reserve) throw new Error(`Unknown Marginfi reserve: ${tokenSymbol}`);
  return reserve;
}
```

**Where to get this data:**
- Program IDs: protocol docs or deployed IDL
- PDAs: derive from protocol seeds or read from protocol SDK constants
- Market/pool configs: protocol dashboard, SDK exports, or on-chain fetch (one-time)
- Oracle addresses: price feed documentation (Pyth, Switchboard)

---

### Layer 5: Codama-Generated Client

**Directory:** `sdk/kit/src/generated/protocols/{protocol}/` (AUTO-GENERATED)
**Action:** Run Codama generator

```bash
# Generate from protocol IDL:
codama generate --from marginfi-idl.json --to sdk/kit/src/generated/protocols/marginfi/
```

This produces instruction builders, account types, error codes, and program definitions. ~1,000-10,000+ files depending on protocol size. Developers never edit these files.

**Output structure:**
```
sdk/kit/src/generated/protocols/marginfi/
├── instructions/         # getDepositInstruction(), getWithdrawInstruction(), etc.
├── accounts/             # Account type decoders
├── types/                # Custom enum and struct types
├── errors/               # Error code mappings
├── programs/             # Program ID and metadata
└── index.ts              # Re-exports everything
```

**If Codama is not available** for a protocol (no IDL), use Pattern B (dynamic SDK import) or Pattern C (compat bridge) instead.

---

### Layer 6: MCP Tools

**Files:** `packages/mcp/src/tools/{protocol}-{action}.ts` (NEW files)
**Action:** Create one file per tool (or group by protocol)

```typescript
import { z } from "zod";

export const marginfiDepositSchema = z.object({
  vault: z.string().describe("Vault PDA address (base58)"),
  tokenMint: z.string().describe("Token to deposit (e.g., 'USDC', 'SOL')"),
  amount: z.string().describe("Amount in token base units (e.g., '1000000' for 1 USDC)"),
});

export async function marginfiDeposit(client, config, input, custodyWallet?) {
  const agentKeypair = loadAgentKeypair(config);
  const result = await client.marginfiDeposit({
    vault: input.vault,
    tokenMint: input.tokenMint,
    amount: toBN(input.amount),
    agent: agentKeypair.publicKey,
  });
  const sig = await client.executeTransaction(result, agentKeypair.publicKey, [agentKeypair]);
  return `## Marginfi Deposit\n- **Token:** ${input.tokenMint}\n- **Amount:** ${input.amount}\n- **Tx:** ${sig}`;
}

export const marginfiDepositTool = {
  name: "shield_marginfi_deposit",
  description: "Deposit tokens into Marginfi lending pool through a Sigil vault",
  schema: marginfiDepositSchema,
  handler: marginfiDeposit,
};
```

**Rules:**
- Tool name: `shield_{protocol}_{action}` (snake_case)
- Schema: Zod with `.describe()` on every field (LLMs read these)
- Handler: async, calls SigilClient methods
- Return: Markdown-formatted result string

**Register in:** `packages/mcp/src/tools/index.ts`

---

## Complete Checklist: Adding a New Protocol

### Prerequisites

- [ ] Protocol's program ID(s) known
- [ ] Protocol's IDL available (for Codama) OR SDK available (for compat bridge)
- [ ] Market/pool addresses documented
- [ ] Each action classified as spending or non-spending
- [ ] Each action mapped to closest ActionType enum value

### Files to Create/Modify

| # | File | Action | Est. Lines |
|---|------|--------|-----------|
| 1 | `sdk/kit/src/intents.ts` | Modify | +10-20 |
| 2 | `sdk/kit/src/integrations/t2-handlers.ts` | Modify | +30-50 |
| 3 | `sdk/kit/src/integrations/{protocol}-compose.ts` | **Create** | 200-400 |
| 4 | `sdk/kit/src/integrations/config/{protocol}-markets.ts` | **Create** | 50-200 |
| 5 | `sdk/kit/src/generated/protocols/{protocol}/` | **Generate** | Auto |
| 6 | `packages/mcp/src/tools/{protocol}-*.ts` | **Create** | 50-100 per tool |
| 7 | `packages/mcp/src/tools/index.ts` | Modify | +5-10 |
| 8 | `sdk/kit/tests/{protocol}*.test.ts` | **Create** | 100-300 |

### Invariants (Must Not Break)

1. **No web3.js in Kit SDK** — use @solana/kit types only (Address, Instruction, TransactionSigner)
2. **compose() returns Kit-native Instructions** — not web3.js TransactionInstruction
3. **No blocking in handler constructor** — lazy init in dispatcher only
4. **Static config is immutable** — never mutate market maps at runtime
5. **One intent → one ActionType** — no ambiguous mappings
6. **Spending classification must be correct** — this drives on-chain cap enforcement

### On-Chain: What You Do NOT Need to Change

- No Rust code changes
- No IDL changes
- No program redeployment
- The protocol just needs to be in the vault's protocol allowlist (PolicyConfig)
- Optional: create generic constraints for byte-level enforcement (leverage caps, market restrictions)

### Setting Up Constraints for the New Protocol

After SDK integration, the vault owner can optionally add on-chain constraints:

```typescript
// Example: Restrict Marginfi to USDC pool only, max deposit 10,000 USDC
await client.createInstructionConstraints(vault, [
  {
    programId: MARGINFI_PROGRAM,
    dataConstraints: [
      {
        offset: 0,                    // instruction discriminator
        operator: "eq",
        value: [...DEPOSIT_DISCRIMINATOR],  // only allow deposit instruction
      },
      {
        offset: 8,                    // deposit amount field
        operator: "lte",
        value: [...u64ToLeBytes(10_000_000_000)],  // max 10,000 USDC (6 decimals)
      },
    ],
    accountConstraints: [
      {
        index: 2,                     // bank account position
        expected: USDC_BANK_ADDRESS,  // only USDC bank allowed
      },
    ],
  },
], { strictMode: false });
```

**Figuring out byte offsets:** Read the protocol's IDL. Borsh serialization puts the 8-byte discriminator at offset 0, then fields in declaration order. Use `anchor idl parse` or the Codama-generated types to identify field positions.

---

## Protocol Integration Decision Tree

```
Is the protocol's IDL available?
├── YES → Use Codama generation (Pattern A) — preferred
│         Generate client, import instruction builders, use static config
│
└── NO → Does the protocol have a TypeScript SDK?
          ├── YES → Is the SDK @solana/kit compatible?
          │         ├── YES → Import directly (rare)
          │         └── NO → Use compat bridge (Pattern C)
          │                  Dynamic import, convert web3.js → Kit Instructions
          │
          └── NO → Manual instruction building
                   Read the program source, build instructions from raw bytes
                   (Last resort — error-prone, hard to maintain)
```

---

## Existing Protocol Implementations (Reference)

| Protocol | Pattern | Handler File | Compose File | Config File |
|----------|---------|-------------|-------------|-------------|
| Jupiter V6 | T1 (special) | `JupiterHandler` in t2-handlers | Built into intent-engine | N/A (uses Jupiter API) |
| Flash Trade | Codama (A) | `FlashTradeHandler` in t2-handlers | `flash-compose.ts` | `config/flash-trade-markets.ts` |
| Drift | SDK bridge (B) | `DriftHandler` in t2-handlers | `drift-compose.ts` | N/A (uses drift-sdk) |
| Kamino | Codama (A) | `KaminoHandler` in t2-handlers | `kamino-compose.ts` | `config/kamino-markets.ts` |
| Squads V4 | SDK (legacy) | `SquadsHandler` in t2-handlers | In typescript SDK | N/A |

Use Flash Trade as the reference implementation for new Codama-based protocols. Use Drift as the reference for SDK-bridge protocols.
