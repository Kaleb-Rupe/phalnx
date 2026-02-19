# @agent-shield/sdk

TypeScript SDK for AgentShield — permission-guarded DeFi access for AI agents on Solana. This is the **Level 3 (on-chain vault)** tier of AgentShield's security model, providing cryptographic guarantees via PDA vaults, on-chain policy enforcement, and atomic transaction composition.

For most use cases, start with [`@agent-shield/solana`](https://www.npmjs.com/package/@agent-shield/solana) (Level 1 — client-side wrapper). Upgrade to this SDK when you need on-chain enforcement that cannot be bypassed even by compromised agent software.

## Installation

```bash
npm install @agent-shield/sdk @coral-xyz/anchor @solana/web3.js
```

Peer dependencies: `@coral-xyz/anchor ^0.32.1`, `@solana/web3.js ^1.95.0`

Optional: `flash-sdk ^12.0.3` (only needed for Flash Trade perpetuals)

## Quick Start

```typescript
import { AgentShieldClient } from "@agent-shield/sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Wallet, BN } from "@coral-xyz/anchor";

const connection = new Connection("https://api.devnet.solana.com");
const wallet = new Wallet(ownerKeypair);
const client = new AgentShieldClient(connection, wallet);

// 1. Create a vault with policy
await client.createVault({
  vaultId: new BN(1),
  dailySpendingCapUsd: new BN(500_000_000),   // $500 USD (6 decimals)
  maxTransactionSizeUsd: new BN(100_000_000),  // $100 per tx
  allowedTokens: [
    { mint: USDC_MINT, oracleFeed: PublicKey.default, decimals: 6, dailyCapBase: new BN(0), maxTxBase: new BN(0) },
  ],
  allowedProtocols: [JUPITER_PROGRAM_ID],
  maxLeverageBps: 0,
  maxConcurrentPositions: 0,
  feeDestination: feeWallet.publicKey,
});

// 2. Deposit funds
const [vaultPDA] = client.getVaultPDA(wallet.publicKey, new BN(1));
await client.deposit(vaultPDA, USDC_MINT, new BN(1_000_000_000));

// 3. Register an agent
await client.registerAgent(vaultPDA, agentKeypair.publicKey);

// 4. Agent executes a swap through Jupiter
const sig = await client.executeJupiterSwap({
  vault: vaultPDA,
  owner: wallet.publicKey,
  vaultId: new BN(1),
  agent: agentKeypair.publicKey,
  inputMint: USDC_MINT,
  outputMint: SOL_MINT,
  amount: new BN(10_000_000),
  slippageBps: 50,
});
```

## On-Chain Account Model

AgentShield uses 4 PDA account types:

| Account | Seeds | Description |
|---------|-------|-------------|
| **AgentVault** | `[b"vault", owner, vault_id]` | Holds owner/agent pubkeys, vault status, fee destination |
| **PolicyConfig** | `[b"policy", vault]` | Spending caps, token/protocol whitelists, leverage limits |
| **SpendTracker** | `[b"tracker", vault]` | Rolling 24h spend entries + bounded audit log (max 50 txs) |
| **SessionAuthority** | `[b"session", vault, agent, token_mint]` | Ephemeral PDA for atomic transaction validation (expires after 20 slots) |

## Instruction Composition Pattern

The SDK uses **atomic multi-instruction transactions** to avoid Solana's 4-level CPI depth limit:

```
Transaction = [
  SetComputeUnitLimit(1_400_000),
  ValidateAndAuthorize,    // AgentShield: check policy, create session PDA
  ...DeFi instructions,    // Jupiter swap / Flash Trade open / etc.
  FinalizeSession          // AgentShield: audit, fees, close session PDA
]
```

All instructions succeed or fail atomically. If the DeFi instruction fails, the session is never finalized and no spend is recorded.

## API Reference

### Vault Management

| Method | Description | Signer |
|--------|-------------|--------|
| `createVault(params)` | Create a new vault with policy, tracker, and fee destination | Owner |
| `deposit(vault, mint, amount)` | Deposit SPL tokens into the vault | Owner |
| `registerAgent(vault, agent)` | Register an agent signing key on the vault | Owner |
| `updatePolicy(vault, params)` | Update policy fields (partial update — only set fields change) | Owner |
| `revokeAgent(vault)` | Freeze the vault (kill switch) | Owner |
| `reactivateVault(vault, newAgent?)` | Unfreeze vault and optionally rotate agent key | Owner |
| `withdraw(vault, mint, amount)` | Withdraw tokens to owner | Owner |
| `closeVault(vault)` | Close vault and reclaim rent | Owner |

### Permission Engine

| Method | Description | Signer |
|--------|-------------|--------|
| `authorizeAction(vault, params)` | Validate agent action against policy, create session PDA | Agent |
| `finalizeSession(vault, agent, success, ...)` | Close session, record audit, collect fees | Agent |

### Transaction Composition

These methods build atomic transactions in the pattern `[ValidateAndAuthorize, DeFi_ix, FinalizeSession]`:

| Method | Description |
|--------|-------------|
| `composePermittedAction(params, computeUnits?)` | Build instruction array for any DeFi action |
| `composePermittedTransaction(params, computeUnits?)` | Build a complete `VersionedTransaction` |
| `composePermittedSwap(params, computeUnits?)` | Shorthand for swap-type actions |
| `composeAndSend(params, signers?, computeUnits?)` | Compose, sign, send, and confirm in one call |

### Jupiter Integration

| Method | Description |
|--------|-------------|
| `getJupiterQuote(params)` | Fetch a swap quote from Jupiter V6 API |
| `jupiterSwap(params)` | Build an unsigned `VersionedTransaction` for a Jupiter swap |
| `executeJupiterSwap(params, signers?)` | Quote, compose, sign, send, and confirm in one call |

### Flash Trade Integration

| Method | Description |
|--------|-------------|
| `flashTradeOpen(params, poolConfig?)` | Compose an open position through Flash Trade |
| `flashTradeClose(params, poolConfig?)` | Compose a close position |
| `flashTradeIncrease(params, poolConfig?)` | Compose an increase position |
| `flashTradeDecrease(params, poolConfig?)` | Compose a decrease position |
| `executeFlashTrade(result, agent, signers?)` | Sign, send, and confirm a Flash Trade transaction |
| `createFlashTradeClient(config?)` | Create/cache a `PerpetualsClient` |
| `getFlashPoolConfig(poolName?, cluster?)` | Get/cache Flash Trade pool config |

### PDA Helpers

```typescript
const [vaultPDA, bump] = client.getVaultPDA(owner, vaultId);
const [policyPDA] = client.getPolicyPDA(vaultPDA);
const [trackerPDA] = client.getTrackerPDA(vaultPDA);
const [sessionPDA] = client.getSessionPDA(vaultPDA, agent, tokenMint);
```

### Account Fetchers

```typescript
// Fetch by owner + vault ID
const vault = await client.fetchVault(owner, vaultId);
const policy = await client.fetchPolicy(vaultPDA);
const tracker = await client.fetchTracker(vaultPDA);

// Fetch by PDA address directly
const vault = await client.fetchVaultByAddress(vaultPDA);
const policy = await client.fetchPolicyByAddress(policyPDA);
const tracker = await client.fetchTrackerByAddress(trackerPDA);
```

## Types

### Instruction Parameters

- **`InitializeVaultParams`** — `vaultId`, `dailySpendingCapUsd`, `maxTransactionSizeUsd`, `allowedTokens` (`AllowedToken[]`), `allowedProtocols`, `maxLeverageBps`, `maxConcurrentPositions`, `feeDestination`
- **`UpdatePolicyParams`** — All policy fields as optionals (only set fields are updated)
- **`AuthorizeParams`** — `actionType`, `tokenMint`, `amount`, `targetProtocol`, `leverageBps?`
- **`ComposeActionParams`** — Full params for composed transactions including `defiInstructions`, `success?`, token accounts

### Account Types

- **`AgentVaultAccount`** — owner, agent, feeDestination, vaultId, status, stats (totalTransactions, totalVolume)
- **`PolicyConfigAccount`** — dailySpendingCapUsd, maxTransactionSizeUsd, allowedTokens (`AllowedToken[]`), allowedProtocols, maxLeverageBps, maxConcurrentPositions, developerFeeRate
- **`SpendTrackerAccount`** — rollingSpends (`SpendEntry[]` with tokenMint, usdAmount, baseAmount, timestamp), recentTransactions (audit log, max 50)
- **`SessionAuthorityAccount`** — vault, agent, actionType, expiresAt, delegated, delegationTokenAccount

### Enums

```typescript
// Vault status
VaultStatus.active    // Normal operation
VaultStatus.frozen    // Kill switch activated
VaultStatus.closed    // Vault closed

// Action types (for validation + audit)
ActionType.swap
ActionType.openPosition
ActionType.closePosition
ActionType.increasePosition
ActionType.decreasePosition
ActionType.deposit
ActionType.withdraw
```

## Constants

```typescript
import {
  AGENT_SHIELD_PROGRAM_ID,  // 4ZeVCqnjUgUtFrHHPG7jELUxvJeoVGHhGNgPrhBPwrHL
  JUPITER_V6_API,            // https://quote-api.jup.ag/v6
  JUPITER_PROGRAM_ID,        // JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4
  FLASH_TRADE_PROGRAM_ID,    // PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu
} from "@agent-shield/sdk";
```

## Architecture

```
Owner creates vault with policy → Agent operates within policy constraints

┌─────────────────────────────────────────────────────────────┐
│  Transaction (atomic — all succeed or all revert)           │
│                                                              │
│  1. SetComputeUnitLimit(1,400,000)                          │
│  2. ValidateAndAuthorize                                     │
│     • Check vault status (Active)                           │
│     • Check agent is registered                             │
│     • Check token/protocol whitelists                       │
│     • Check spending cap (rolling 24h)                      │
│     • Check leverage limits (if perp)                       │
│     • Create SessionAuthority PDA                           │
│  3. DeFi Instruction (Jupiter swap, Flash Trade, etc.)      │
│  4. FinalizeSession                                         │
│     • Record in audit log                                   │
│     • Update open positions counter                         │
│     • Collect protocol + developer fees                     │
│     • Close SessionAuthority PDA (reclaim rent)             │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| One agent per vault | Multiple agents = multiple vaults. Simplifies permission model. |
| Rolling 24h window | Not calendar-day. Prevents edge-case burst at midnight. |
| Fees at finalization only | Not at authorization. Prevents fee charging on failed txs. |
| Immutable fee destination | Prevents owner from changing fee recipient after vault creation. |
| Bounded vectors | Max 10 tokens, 10 protocols, 100 spend entries, 50 audit records. |

### Policy Constraints

| Field | Range | Description |
|-------|-------|-------------|
| `dailySpendingCapUsd` | `u64` | Max aggregate USD spend in rolling 24h window (6 decimals) |
| `maxTransactionSizeUsd` | `u64` | Max single transaction USD value (6 decimals) |
| `allowedTokens` | max 10 | `AllowedToken[]` — mint, oracleFeed, decimals, dailyCapBase, maxTxBase |
| `allowedProtocols` | max 10 | Program ID whitelist |
| `maxLeverageBps` | `u16` | Max leverage in basis points |
| `maxConcurrentPositions` | `u8` | Max open positions |
| `developerFeeRate` | 0–500 | Developer fee in BPS (max 5%) |

## Security Model

This is **Level 3** in AgentShield's three-tier architecture:

```
Level 1: Client-Side Wrapper (@agent-shield/solana)
  → Intercepted signTransaction, client-side policy checks
  → Can be bypassed by determined attacker with key access

Level 2: TEE-Backed Signing (coming soon)
  → Private keys in Trusted Execution Environment
  → Agent code never touches keys

Level 3: On-Chain Vault (this package)
  → PDA vault with on-chain PolicyConfig
  → Cannot be bypassed — policy enforced by Solana validators
  → Cryptographic guarantees via atomic transactions
```

**On-chain enforcement means:**
- Agent cannot exceed spending caps even if the agent software is compromised
- Owner can freeze the vault at any time (kill switch)
- All transactions are audited in the SpendTracker
- Session PDAs expire after 20 slots (~8 seconds)
- Fee destination is immutable after creation

## Devnet

Program deployed to devnet at: `4ZeVCqnjUgUtFrHHPG7jELUxvJeoVGHhGNgPrhBPwrHL`

IDL account: `Ev3gSzxLw6RwExAMpTHUKvn2o9YVULxiWehrHee7aepP`

## Related Packages

| Package | Description |
|---------|-------------|
| [`@agent-shield/solana`](https://www.npmjs.com/package/@agent-shield/solana) | Client-side wallet wrapper (Level 1) |
| [`@agent-shield/core`](https://www.npmjs.com/package/@agent-shield/core) | Pure TypeScript policy engine |
| [`@agent-shield/plugin-solana-agent-kit`](https://www.npmjs.com/package/@agent-shield/plugin-solana-agent-kit) | Solana Agent Kit integration |
| [`@agent-shield/plugin-elizaos`](https://www.npmjs.com/package/@agent-shield/plugin-elizaos) | ElizaOS integration |

## License

MIT
