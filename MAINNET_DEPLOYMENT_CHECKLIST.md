# Mainnet Deployment Checklist

Pre-mainnet checklist for Phalnx. Every box must be checked before deploying to mainnet-beta.

---

## 1. On-Chain Program

### Feature Flag Flip

- [ ] Build with `--features mainnet` (NOT `devnet`): `anchor build --no-idl --features mainnet`
- [ ] Verify `devnet-testing` feature is NOT enabled (accepts any mint as stablecoin — catastrophic on mainnet)
- [ ] Verify compile-time guards pass: `cargo build --no-default-features --features mainnet` succeeds
- [ ] Verify `devnet-testing` + `mainnet` fails: `cargo build --no-default-features --features "devnet-testing,mainnet"` produces compile_error

### PROTOCOL_TREASURY Address

- [ ] Replace zero-address placeholder in `programs/phalnx/src/state/mod.rs` (line ~91) with real mainnet treasury pubkey
- [ ] Verify build-time test `mainnet_treasury_must_not_be_zero()` passes with new address
- [ ] Treasury address matches Squads multisig vault (Section 7)

### Stablecoin Mint Verification

- [ ] Mainnet USDC mint matches `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (already hardcoded in state/mod.rs)
- [ ] Mainnet USDT mint matches `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` (already hardcoded in state/mod.rs)
- [ ] `is_stablecoin_mint()` uses strict USDC/USDT-only check (no `devnet-testing` wildcard)

### Program Deployment

- [ ] Deploy to mainnet-beta with upgrade authority: `solana program deploy target/deploy/phalnx.so --program-id 4ZeVCqnjUgUtFrHHPG7jELUxvJeoVGHhGNgPrhBPwrHL --upgrade-authority <deployer-keypair> --url mainnet-beta`
- [ ] Verify program deployed: `solana program show 4ZeVCqnjUgUtFrHHPG7jELUxvJeoVGHhGNgPrhBPwrHL --url mainnet-beta`
- [ ] Record binary SHA-256 hash for verifiable build: `sha256sum target/deploy/phalnx.so`
- [ ] Save deploy metadata (commit, binary hash, timestamp, Anchor/Solana versions)

### IDL Deployment (Mainnet)

- [ ] Deploy IDL: `anchor idl init --filepath target/idl/phalnx.json 4ZeVCqnjUgUtFrHHPG7jELUxvJeoVGHhGNgPrhBPwrHL --provider.cluster mainnet-beta`
- [ ] Verify IDL on-chain: `anchor idl fetch 4ZeVCqnjUgUtFrHHPG7jELUxvJeoVGHhGNgPrhBPwrHL --provider.cluster mainnet-beta` shows 29 instructions, 9 accounts, 70 errors
- [ ] Committed IDL matches on-chain IDL (diff `target/idl/phalnx.json` against fetched)

### Upgrade Authority Transfer

- [ ] Transfer program upgrade authority from deployer to Squads multisig: `solana program set-upgrade-authority 4ZeVCqnjUgUtFrHHPG7jELUxvJeoVGHhGNgPrhBPwrHL --new-upgrade-authority <squads-vault-pubkey>`
- [ ] Transfer IDL authority to Squads multisig: `anchor idl set-authority --new-authority <squads-vault-pubkey> 4ZeVCqnjUgUtFrHHPG7jELUxvJeoVGHhGNgPrhBPwrHL --provider.cluster mainnet-beta`
- [ ] Verify: `solana program show 4ZeVCqnjUgUtFrHHPG7jELUxvJeoVGHhGNgPrhBPwrHL --url mainnet-beta` shows multisig as authority
- [ ] Document the deployer keypair securely (needed if multisig ever needs to delegate back)

---

## 2. Address Lookup Table (ALT)

Reference: `docs/DEPLOYMENT.md` for step-by-step commands.

- [ ] Create mainnet ALT: `solana address-lookup-table create --keypair <authority> --url mainnet-beta`
- [ ] Extend with 5 accounts (order matters):

| # | Account | Mainnet Address |
|---|---------|-----------------|
| 0 | USDC Mint | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| 1 | USDT Mint | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` |
| 2 | Protocol Treasury | `<mainnet-treasury-pubkey>` |
| 3 | Instructions Sysvar | `Sysvar1nstructions1111111111111111111111111` |
| 4 | Clock Sysvar | `SysvarC1ock11111111111111111111111111111111` |

- [ ] Wait for finality (~60s on mainnet)
- [ ] Verify ALT contents: `solana address-lookup-table get <ALT_ADDRESS> --url mainnet-beta --output json`
- [ ] Update `sdk/kit/src/alt-config.ts`: replace `PHALNX_ALT_MAINNET` placeholder (`11111...`) with real ALT address
- [ ] Update `EXPECTED_ALT_CONTENTS_MAINNET` in alt-config.ts with mainnet treasury address
- [ ] Transfer ALT authority to Squads multisig — see [Section 11: ALT Authority Migration](#11-alt-authority-migration-to-squads-v4) for detailed steps

---

## 3. NPM Package Publishing

### Package Registry

All 6 packages need npm OIDC Trusted Publishing configured:

| Package | Current Version | publishConfig |
|---------|----------------|---------------|
| `@phalnx/core` | 0.1.5 | needs adding |
| `@phalnx/platform` | 0.1.4 | needs adding |
| `@phalnx/kit` | 0.1.0 | needs adding |
| `@phalnx/custody-turnkey` | 0.1.0 | configured |
| `@phalnx/custody-crossmint` | 0.1.4 | needs adding |
| `@phalnx/custody-privy` | 0.1.0 | needs adding |

- [ ] Configure Trusted Publishing on npmjs.com for each package: Package Settings → Publishing Access → Trusted Publishers → GitHub Actions (repo: `Kaleb-Rupe/phalnx`, workflow: `release.yml`, environment: `production`)
- [ ] Add `publishConfig` to all packages missing it (access: public, provenance: true, registry: https://registry.npmjs.org/)
- [ ] Verify `pnpm changeset publish --dry-run` succeeds for all packages
- [ ] Update `@phalnx/kit` types.ts: ensure mainnet network config points to correct program ID and ALT
- [ ] All packages build cleanly: `pnpm -r run build`
- [ ] Version bump via changesets for mainnet release (all packages should be ≥1.0.0 for mainnet)

### SDK Config Updates

- [ ] `sdk/kit/src/types.ts`: verify `PHALNX_PROGRAM_ADDRESS` works on mainnet (same program ID across networks)
- [ ] `sdk/kit/src/alt-config.ts`: `PHALNX_ALT_MAINNET` updated from placeholder
- [ ] `sdk/kit/src/types.ts`: `PROTOCOL_TREASURY` matches on-chain mainnet address
- [ ] All test suites pass with mainnet config: core (66), platform (17), crossmint (29), kit (1156+)

---

## 4. Infrastructure

### Vercel Environment Variables

Project: `agent-middleware.vercel.app`

| Variable | Scope | Notes |
|----------|-------|-------|
| `SOLANA_RPC_URL` | Production | Switch from devnet Helius to mainnet Helius RPC endpoint |
| `CROSSMINT_API_KEY` | Production | Production Crossmint API key (mark as Sensitive) |
| `PHALNX_PROGRAM_ID` | Production | `4ZeVCqnjUgUtFrHHPG7jELUxvJeoVGHhGNgPrhBPwrHL` (same across networks) |

- [ ] Update `SOLANA_RPC_URL` to mainnet Helius endpoint
- [ ] Update `CROSSMINT_API_KEY` to production key (or remove if not using Crossmint on mainnet)
- [ ] Set `PHALNX_PROGRAM_ID` (or confirm default is correct)
- [ ] Verify security headers in `vercel.json` are production-ready (HSTS, X-Frame-Options, CSP — currently configured)
- [ ] Confirm Vercel project is on the correct plan (team/pro) for production traffic

### DNS / Domain

- [ ] Configure production domain (if not using `agent-middleware.vercel.app`)
- [ ] Set up SSL/TLS (automatic with Vercel custom domains)
- [ ] Update CORS origins if applicable

### CI/CD Pipeline — Mainnet Deploy Workflow

Currently only `deploy-devnet.yml` exists. Mainnet needs:

- [ ] Create `.github/workflows/deploy-mainnet.yml` (adapted from deploy-devnet.yml)
- [ ] Mainnet deploy should require manual approval (not auto-deploy on push)
- [ ] Add GitHub environment `mainnet` with required reviewers and deployment protection rules
- [ ] Add GitHub Secrets for `mainnet` environment:
  - `MAINNET_DEPLOY_KEYPAIR` — upgrade authority keypair (JSON byte array)
  - `MAINNET_RPC_URL` — mainnet Helius RPC endpoint
- [ ] Update `release.yml` if packages should only publish after mainnet deploy succeeds
- [ ] Verify `ci.yml` runs mainnet feature build in build-verification job

### GitHub Secrets Audit

- [ ] Review all GitHub Actions secrets — remove stale ones, rotate if exposed
- [ ] Verify `DEVNET_RPC_URL`, `DEVNET_WALLET_KEYPAIR`, `DEVNET_DEPLOY_KEYPAIR` still valid
- [ ] Add `MAINNET_DEPLOY_KEYPAIR` (Squads signer or deployer key, depending on authority model)
- [ ] Add `MAINNET_RPC_URL` (Helius mainnet with sufficient rate limits)
- [ ] Verify `CI_APP_PRIVATE_KEY` and `CI_APP_ID` are scoped correctly

---

## 5. Security

### Code Audit

- [ ] Run Sec3 X-Ray static analysis: `sec3 autoaudit --all` — zero critical/high findings
- [ ] Run Certora formal verification: all specs in `programs/phalnx/src/certora/specs/` pass
- [ ] Run Trident fuzz tests: `trident fuzz run-hfuzz fuzz_0 -- -n 10000` — no panics
- [ ] Manual review of all 29 instructions for checked math (no raw `+`, `-`, `*`, `/` on u64)
- [ ] Review all `require!()` and `require_keys_eq!()` guards are correct
- [ ] Verify all 70 error codes are reachable and tested

### CU / Transaction Size Optimization

- [ ] Profile CU usage for all composed transaction patterns (validate + DeFi + finalize)
- [ ] Verify composed transactions fit within 1.4M CU budget with compute budget instruction
- [ ] Measure transaction size: composed TX with ALT compression stays under 1232 bytes
- [ ] Verify zero-copy accounts (SpendTracker, AgentSpendOverlay) don't cause CU spikes
- [ ] Test with mainnet priority fees: CU price estimation via Helius `getRecentPrioritizationFees`

### Dependency Audit

- [ ] `cargo audit` — no known vulnerabilities in Rust dependencies
- [ ] `pnpm audit` — no known vulnerabilities in JS dependencies
- [ ] Verify pinned versions: `blake3 = "=1.5.5"`, `anchor-lang = "0.32.1"`, `anchor-spl = "0.32.1"`
- [ ] No external crates beyond anchor-lang, anchor-spl, solana-program, bytemuck, blake3

---

## 6. GitHub Repository Security

### Open vs Private Split

- [ ] Identify what stays in public repo (`Kaleb-Rupe/phalnx`):
  - On-chain program (`programs/phalnx/`)
  - SDK packages (`sdk/`)
  - CI workflows (`.github/workflows/`)
  - IDL (`target/idl/`, `target/types/`)
  - `README.md`, `SECURITY.md`, `LICENSE`
- [ ] Identify what moves to private repo:
  - Dashboard app (currently at `../dashboard`)
  - Turnkey custody integration for dashboard
  - Internal deployment scripts
  - Proprietary MCP tools (if monetized)
- [ ] Verify `.gitignore` excludes sensitive files:
  - `.env`, `.env.local`, `.env.*.local` — confirmed
  - `docs/` — currently gitignored (internal development docs)
  - `CLAUDE.md` — currently gitignored
  - `.claude/` — currently gitignored
  - `/MEMORY` — currently gitignored
- [ ] Remove any leaked secrets from git history (use `git filter-repo` if needed)
- [ ] Enable GitHub branch protection on `main`: require PR reviews, require CI pass, no force push
- [ ] Enable Dependabot for security updates
- [ ] Enable secret scanning and push protection on the repo
- [ ] Review GitHub App permissions (`CI_APP_ID`) — scope to minimum needed

---

## 7. Treasury Wallet (Squads Multisig)

- [ ] Create Squads V4 multisig on mainnet for protocol treasury
- [ ] Configure multisig threshold (e.g., 2-of-3, 3-of-5)
- [ ] Add all required signers to the multisig
- [ ] Initialize USDC token account owned by the multisig vault
- [ ] Initialize USDT token account owned by the multisig vault
- [ ] Set multisig vault pubkey as `PROTOCOL_TREASURY` in `state/mod.rs` (Section 1)
- [ ] Verify `fee_destination` in vault creation matches treasury token account
- [ ] Fund multisig with enough SOL for rent-exempt token accounts and future program upgrades
- [ ] Document emergency procedures: who can sign, recovery keys, escalation path
- [ ] Test fee collection end-to-end on devnet with a multisig-owned treasury before mainnet

---

## 8. Turnkey Custody Setup

For the dashboard private repo — agent signing infrastructure:

- [ ] Create Turnkey organization for production
- [ ] Generate Turnkey API key pair (production, separate from dev)
- [ ] Configure sub-organization for agent wallet management
- [ ] Set up wallet creation policy (key type: Solana ed25519)
- [ ] Configure signing policy: require TEE attestation for agent operations
- [ ] Store Turnkey credentials in dashboard repo's environment (NOT in public phalnx repo)
- [ ] Verify `@phalnx/custody-turnkey` adapter works against production Turnkey org
- [ ] Test agent wallet provisioning end-to-end
- [ ] Document Turnkey recovery procedures (organization recovery, key rotation)
- [ ] Set up Turnkey webhook monitoring for signing events

---

## 9. Post-Deploy Verification

- [ ] Run full devnet test suite against mainnet-deployed program (with mainnet-compatible test wallets)
- [ ] Verify vault creation works on mainnet (create test vault, fund with small USDC amount)
- [ ] Verify `validate_and_authorize` → DeFi instruction → `finalize_session` atomic composition on mainnet
- [ ] Verify fee collection: treasury token account receives correct fee amount
- [ ] Verify spending caps enforce correctly (attempt over-limit transaction, confirm rejection)
- [ ] Verify ALT compression: composed TX uses lookup table correctly
- [ ] Monitor first 24h of mainnet transactions for unexpected errors
- [ ] Verify explorer links work: Solscan, Solana Explorer show program and transactions correctly
- [ ] Confirm Helius RPC performance: no rate limiting, acceptable latency

---

## 10. Pre-Launch Final Checks

- [ ] All sections above are complete (1–11)
- [ ] `anchor build --no-idl --features mainnet` produces identical binary to deployed program
- [ ] `git checkout -- target/idl/ target/types/` — committed IDL matches after build
- [ ] No `TODO`, `FIXME`, or `HACK` in production code paths
- [ ] SECURITY.md contact info is current
- [ ] README.md reflects mainnet status and installation instructions
- [ ] CHANGELOG.md generated by changesets for all packages
- [ ] Emergency procedures documented and tested (circuit breaker, vault freeze, multisig program upgrade)

---

## 11. ALT Authority Migration to Squads V4

> Extracted from ON-CHAIN-IMPLEMENTATION-PLAN.md Section 2 (Steps 2.0-2.4).
> Requires 3 distinct keypair holders for 2-of-3 Squads V4 multisig.

### Context

The Phalnx ALT on devnet is controlled by a single EOA keypair: `6wrkKTM2pjkcCAbMfRz2j3AXspavu6pq3ePcuJUE3Azp`. If this keypair is lost or compromised, the authority can deactivate the ALT (liveness DoS) or extend it with malicious addresses.

### Steps

- [ ] **11.1** Install `@sqds/multisig` devDependency: `pnpm add -Dw @sqds/multisig`
- [ ] **11.2** Create Squads V4 multisig vault (2-of-3) on devnet — new script `scripts/create-alt-multisig.ts` using `multisig.instructions.multisigCreateV2()` and `multisig.getMultisigPda()`
- [ ] **11.3** Create NEW ALT with Squads PDA as authority, migrate all entries from old ALT, update `PHALNX_ALT_DEVNET` in `sdk/kit/src/alt-config.ts`, deactivate old ALT — new script `scripts/migrate-alt-authority.ts`. Note: Solana ALTs do NOT support SetAuthority, so this is a create-and-migrate approach.
- [ ] **11.4** Update `scripts/extend-phalnx-alt.ts` to build Squads proposals instead of direct signing
- [ ] **11.5** (POST-MAINNET) Optional: Freeze ALT via `FreezeLookupTable` — only after upgrade authority is renounced. Irreversible.

### TOCTOU Mitigation

During the migration grace period, deactivate the old ALT immediately (not after 14 days). SDK clients get a recoverable transaction failure, update to new alt-config.ts, and retry.

### Testing

- Verify Squads vault exists on devnet: `solana account <pda>`
- Verify new ALT contents match `EXPECTED_ALT_CONTENTS_DEVNET`
- Run `pnpm --filter @phalnx/kit test:devnet` against new ALT
- Verify old ALT deactivation doesn't break SDK (grace period behavior)
