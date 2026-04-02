# Storage Implementation Plan

**Status:** PROPOSED — Pending approval
**Created:** 2026-03-25 (consolidated from research + two council reviews)
**Research basis:** `MEMORY/WORK/20260324-143000_solana-storage-options-research/SOLANA-STORAGE-ANALYSIS.md`
**Research method:** 9 parallel agents (3 Claude, 3 Gemini, 3 Grok) evaluating 11 storage solutions
**Council reviews:** (1) Quick Council 2026-03-24 — storage solution selection, (2) Full Debate 2026-03-25 — repo placement (5 members, 3 rounds)
**Depends on:** Phase 5 (SDK additions) COMPLETE, Phase 6 (analytics data layer) COMPLETE

---

## 1. Problem Statement

Sigil has 5 off-chain storage gaps that block the dashboard, compliance, and long-term analytics:

| # | Gap | Why It Matters | Current State |
|---|-----|---------------|---------------|
| 1 | **Event archival** | Solana prunes tx logs after ~2 days. Activity feed, audit trail, compliance all need durable event history | 31 event types emitted via `emit!()` across 28 instructions. Ephemeral. |
| 2 | **Spend history >24h** | SpendTracker circular buffer (144 epochs = 24h) overwrites old data. Dashboard charts need months/years | On-chain 2,840B/vault, rolling overwrite every 10 min |
| 3 | **Balance snapshots** | P&L charts need historical balances. BalanceSnapshotStore is in-memory, session-scoped | Lost on every restart. `sdk/kit/src/balance-tracker.ts` |
| 4 | **TEE attestation proofs** | Compliance needs durable attestation evidence. Current cache is 1hr TTL in-memory | `sdk/kit/src/tee/cache.ts` — 1000-entry LRU, volatile |
| 5 | **Vault metadata** | Dashboard needs vault names, descriptions, agent labels. No on-chain field for this | Doesn't exist anywhere yet |

**Volume estimates at scale (100 active vaults, 10 agents):**
- Events: ~1,000/day (~500KB/day, ~15MB/month)
- Spend snapshots: 144 epochs/vault/day x 100 vaults = 14,400 rows/day
- Balance snapshots: hourly x 100 vaults = 2,400 rows/day
- TEE proofs: ~100/day
- Vault metadata: ~100 records, rarely updated

---

## 2. Chosen Stack

Decided 2026-03-24 after evaluating 11 solutions across cost, latency, maturity, trust model, and migration risk. Council-validated (4 members, unanimous).

| Component | Role | Cost | Migration Risk |
|-----------|------|------|----------------|
| **Helius LaserStream** | Real-time gRPC event streaming filtered by Sigil program ID | $49-499/mo | MEDIUM — Yellowstone gRPC protocol is portable to Triton/Chainstack |
| **PostgreSQL** | Queryable store for all 5 data types | $0-25/mo (Supabase free tier to Pro) | ZERO — universally portable |
| **Arweave** | Permanent tamper-evident audit archival | ~$0.10/mo at current volume | LOW — content-addressed, multiple gateways |

**Monthly cost: ~$50-525/mo** depending on Helius tier.

### Rejected Solutions (with rationale from research)

| Solution | Verdict | Reason |
|----------|---------|--------|
| Shadow Drive (GenesysGo) | DO NOT ADOPT | Dying: SHDW -98.9% from ATH, no production users, V2 Android-APK-only vaporware, data loss if project dies |
| Ceramic / ComposeDB | DO NOT ADOPT | Solana auth-only, data anchors to Ethereum, beta after 3 years, can't handle Solana event throughput |
| IPFS standalone | DO NOT ADOPT | Not permanent — unpinned = deleted. Arweave strictly superior for archival |
| Clockwork | DEAD | Shut down August 2023. Successor Tuk Tuk is early stage. |
| Irys (formerly Bundlr) | SKIP | Deprecated Arweave bundler, pivoting to own L1. Use `arweave-js` directly |
| ZK Compression | NOT NOW | Solves on-chain rent (Sigil PDAs are 634B-8.3KB — rent is trivial). Revisit at 10K+ vaults |

### Watch List (re-evaluate Q2-Q3 2026)

| Solution | Trigger to Adopt | Value |
|----------|-----------------|-------|
| **The Graph Substreams** | Horizon mainnet stable + Anchor IDL import proven | Could replace custom decoder with decentralized indexing. Native Anchor IDL support is unique. |
| **Old Faithful** | Need to backfill events from before pipeline launch | Historical tx archive, Solana Foundation-backed, 250TB+, content-addressed CAR files |
| **ClickHouse** | Event volume exceeds 10M rows or analytics queries slow down | OLAP engine for analytical queries alongside Postgres OLTP |

---

## 3. Repository Placement

### Decision: Separate private `sigil-infra` repo

**Council debated this across 3 rounds with 5 members (Architect, Engineer, Security, Researcher, Designer). Started 3-2 split, converged to unanimous monorepo — then the public repo constraint changed the answer.**

`agent-middleware` is a **public open-source repository**. The indexer holds Postgres credentials, Helius API keys, and an Arweave wallet private key. Infrastructure code, deploy configurations, and CI workflows with secret scoping should not live in a public repo.

| Option | Verdict | Why |
|--------|---------|-----|
| `packages/indexer/` in public `agent-middleware` | **NO** | Infrastructure code + deploy config publicly visible. CI secret scoping visible to attackers. |
| `services/indexer/` in public `agent-middleware` | **NO** | Same problem regardless of directory name. |
| Inside `apps/admin/` in public repo | **NO** | Admin dashboard also holds server-side secrets (Postgres, Arweave, Helius). |
| **Separate private `sigil-infra` repo** | **YES** | Private repo for all non-public infrastructure. Clean security boundary. |

### Final Structure

```
PUBLIC REPO — agent-middleware (GitHub: open source)
├── programs/sigil/          Rust on-chain program
├── sdk/kit/                  @usesigil/kit — event decoders, analytics, state resolver
├── sdk/custody/              Turnkey/Crossmint/Privy adapters
├── packages/                 Plugins (SAK, etc.)
├── tests/                    LiteSVM, Surfpool, Devnet tests
├── docs/                     Public documentation
└── Published to npm with OIDC provenance

PRIVATE REPO — sigil-infra (GitHub: private)
├── services/
│   └── indexer/              Helius → Postgres → Arweave pipeline
│       ├── src/
│       │   ├── stream.ts         LaserStream gRPC client
│       │   ├── decoder.ts        Event decoder (imports @usesigil/kit from npm)
│       │   ├── writer.ts         Postgres event writer
│       │   ├── crons/            Spend/balance/archive cron jobs
│       │   ├── archive/          Arweave upload + verification
│       │   └── api/              Health + metrics endpoints
│       ├── migrations/           SQL schema
│       ├── Dockerfile
│       ├── package.json
│       └── tests/
├── apps/
│   └── admin/                Owner-only protocol cockpit (per ADMIN-DASHBOARD-PLAN.md)
│       ├── src/
│       │   ├── app/              Next.js App Router pages
│       │   ├── components/       UI components
│       │   └── lib/              Auth (SIWS), operations, hooks
│       └── package.json
├── packages/
│   └── shared-types/         Shared TypeScript types between indexer + admin
│       └── package.json
├── pnpm-workspace.yaml       services/*, apps/*, packages/*
├── .env.example
└── .github/workflows/
    ├── indexer-deploy.yml    Deploys to Railway/Fly.io (uses indexer-deploy environment)
    └── admin-deploy.yml      Deploys to Vercel (uses admin-deploy environment)
```

### Why This Structure

| Principle | How It's Applied |
|-----------|-----------------|
| **Public/private boundary** | On-chain program + SDK = public (open source). Infrastructure + admin = private (secrets, deploy config). |
| **Clean interface** | `sigil-infra` imports `@usesigil/kit` from npm (published with OIDC provenance). No workspace link across repos. |
| **Atomic infra changes** | Indexer + admin share one repo because they share Postgres, secrets, and deploy lifecycle. |
| **No accidental import** | Indexer is in `services/` (not `packages/`) — signals "thing that runs" not "library to import". |
| **Security isolation** | CI secrets scoped per GitHub environment. Indexer deploy has Arweave key. Admin deploy has JWT secret. Neither touches program deploy keys (those stay in the public repo). |

### Council Security Requirements (non-negotiable)

These apply regardless of repo placement. From Security (Kai), accepted by all 5 members:

1. **Isolated CI environments.** Indexer deploy workflow gets its own GitHub environment (`indexer-deploy`) with Arweave + Postgres credentials. Admin deploy gets `admin-deploy` with JWT secret. Neither can access program signing keys.
2. **No shared service accounts.** Indexer's Arweave wallet and database credentials are distinct from anything the program or SDK touches.
3. **Read-only program interface.** The indexer consumes on-chain state and events. It never holds signing authority over vaults, never submits transactions, never touches keypairs.
4. **Dependency firewall.** Shared types go in `packages/shared-types/` with zero runtime dependencies. The indexer imports `@usesigil/kit` from npm for event decoding — not from a workspace link to the public repo.
5. **CODEOWNERS on workflows.** `.github/workflows/` changes require explicit approval to prevent malicious workflow additions.

### Extraction Triggers (from Researcher)

If team grows, the indexer and admin can be split into separate repos. Trigger: 2 of 3 must be true:
1. Indexer needs independent release cadence from admin dashboard
2. Team exceeds 3 engineers working on indexer-specific code
3. Indexer dependencies create meaningful CI bloat (build time doubles)

---

## 4. Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Solana Network                         │
│           Sigil Program: 4ZeVCqnjUgUtFrHHPG7jELUxvJeoV │
│                                                          │
│  31 event types x 36 emit!() calls across 28 instructions│
└────────────────────────┬─────────────────────────────────┘
                         │
                   Helius LaserStream
                   (Yellowstone gRPC)
                   Filter: program_id
                         │
              ┌──────────┴──────────┐
              │   Event Decoder      │
              │   (TypeScript)       │
              │                      │
              │ Uses @usesigil/kit:    │ ← installed from npm
              │ • parseSigilEvents()│
              │ • parseAndDecode()   │
              │ • 31 typed decoders  │
              └──────────┬──────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
┌──────────────┐  ┌────────────┐  ┌──────────────┐
│  PostgreSQL  │  │  Arweave   │  │  Consumers   │
│  (hot store) │  │  (archive) │  │              │
│              │  │            │  │ • Admin      │
│ 6 tables:    │  │ Daily      │  │   dashboard  │
│ • events     │  │ batch of   │  │   (private)  │
│ • spend_     │  │ serialized │  │              │
│   snapshots  │  │ events     │  │ • Public     │
│ • balance_   │  │            │  │   dashboard  │
│   snapshots  │  │ Arweave TX │  │   (future)   │
│ • tee_proofs │  │ IDs stored │  │              │
│ • vault_     │  │ in Postgres│  │ • External   │
│   metadata   │  │ for cross- │  │   consumers  │
│ • archives   │  │ reference  │  │   (future)   │
└──────────────┘  └────────────┘  └──────────────┘
```

### Data Flow

1. **LaserStream** receives all Sigil transactions in real-time via Yellowstone gRPC
2. **Decoder** extracts `"Program data: "` log lines, matches against 31 event discriminators using `@usesigil/kit`
3. **Events** are written to Postgres with full decoded fields (vault, agent, amount, action type, protocol, timestamp)
4. **Cron jobs** run independently:
   - Spend snapshot cron: reads SpendTracker circular buffer before overwrite, stores time-series
   - Balance snapshot cron: reads token balances per vault, stores for P&L charts
   - Archive cron: batches day's events, uploads to Arweave, stores tx ID in Postgres
5. **Consumers** query Postgres for display data (admin dashboard, future public dashboard)

---

## 5. Database Schema

### 5.1 `events` — Decoded Sigil events

```sql
CREATE TABLE events (
  id            BIGSERIAL PRIMARY KEY,
  signature     TEXT NOT NULL,
  slot          BIGINT NOT NULL,
  block_time    TIMESTAMPTZ NOT NULL,
  event_name    TEXT NOT NULL,
  category      TEXT NOT NULL,
  vault         TEXT NOT NULL,
  agent         TEXT,
  amount_usd    BIGINT,
  token_mint    TEXT,
  action_type   TEXT,
  protocol      TEXT,
  protocol_name TEXT,
  success       BOOLEAN NOT NULL DEFAULT TRUE,
  fields        JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_vault_time    ON events (vault, block_time DESC);
CREATE INDEX idx_events_agent_time    ON events (agent, block_time DESC) WHERE agent IS NOT NULL;
CREATE INDEX idx_events_category_time ON events (category, block_time DESC);
CREATE INDEX idx_events_signature     ON events (signature);
CREATE UNIQUE INDEX idx_events_sig_name ON events (signature, event_name);
```

### 5.2 `spend_snapshots` — SpendTracker circular buffer persistence

```sql
CREATE TABLE spend_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  vault         TEXT NOT NULL,
  epoch_index   INT NOT NULL,
  epoch_start   BIGINT NOT NULL,
  amount_usd    BIGINT NOT NULL,
  tx_count      INT NOT NULL DEFAULT 0,
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_spend_vault_time ON spend_snapshots (vault, epoch_start DESC);
CREATE UNIQUE INDEX idx_spend_dedup ON spend_snapshots (vault, epoch_index, epoch_start);
```

### 5.3 `balance_snapshots` — Hourly vault balance history

```sql
CREATE TABLE balance_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  vault         TEXT NOT NULL,
  timestamp     TIMESTAMPTZ NOT NULL,
  usdc_balance  BIGINT NOT NULL DEFAULT 0,
  usdt_balance  BIGINT NOT NULL DEFAULT 0,
  total_usd     BIGINT NOT NULL DEFAULT 0,
  token_balances JSONB,
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_balance_vault_time ON balance_snapshots (vault, timestamp DESC);
```

### 5.4 `tee_proofs` — TEE attestation evidence

```sql
CREATE TABLE tee_proofs (
  id              BIGSERIAL PRIMARY KEY,
  agent_pubkey    TEXT NOT NULL,
  attestation     JSONB NOT NULL,
  verified        BOOLEAN NOT NULL,
  provider        TEXT NOT NULL,
  expires_at      TIMESTAMPTZ,
  arweave_tx_id   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tee_agent ON tee_proofs (agent_pubkey, created_at DESC);
```

### 5.5 `vault_metadata` — Dashboard-managed vault info

```sql
CREATE TABLE vault_metadata (
  vault         TEXT PRIMARY KEY,
  owner         TEXT NOT NULL,
  name          TEXT,
  description   TEXT,
  agent_labels  JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 5.6 `event_archives` — Arweave archival cross-reference

```sql
CREATE TABLE event_archives (
  id              BIGSERIAL PRIMARY KEY,
  archive_date    DATE NOT NULL UNIQUE,
  event_count     INT NOT NULL,
  first_slot      BIGINT NOT NULL,
  last_slot       BIGINT NOT NULL,
  arweave_tx_id   TEXT NOT NULL,
  byte_size       INT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_archives_date ON event_archives (archive_date DESC);
```

---

## 6. Implementation Steps

All implementation happens in the **private `sigil-infra` repo** under `services/indexer/`.

### Phase 1: Repo Setup + Event Pipeline (target: 1 week)

| Step | Task | Files | Acceptance Criteria |
|------|------|-------|-------------------|
| 1.1 | **Create `sigil-infra` private repo** | `package.json`, `pnpm-workspace.yaml`, `tsconfig.json` | Private GitHub repo, pnpm workspace with `services/*`, `apps/*`, `packages/*` |
| 1.2 | **Create `services/indexer/` package** | `services/indexer/package.json`, `tsconfig.json`, `Dockerfile` | TypeScript, depends on `@usesigil/kit` from npm |
| 1.3 | **Database migrations** | `services/indexer/migrations/001_create_tables.sql` | All 6 tables from schema above, idempotent |
| 1.4 | **Helius LaserStream client** | `services/indexer/src/stream.ts` | Connects to Helius gRPC, filters by Sigil program ID, handles reconnection with 24h replay |
| 1.5 | **Event decoder adapter** | `services/indexer/src/decoder.ts` | Imports `parseAndDecodeSigilEvents()` from `@usesigil/kit`, maps to Postgres row, uses `categorizeEvent()` |
| 1.6 | **Event writer** | `services/indexer/src/writer.ts` | Batch inserts to `events` table, handles dedup via unique constraint |
| 1.7 | **Integration test** | `services/indexer/tests/pipeline.test.ts` | Mock LaserStream to decoder to writer pipeline |

### Phase 2: Snapshot Crons + Metadata (target: 1 week)

| Step | Task | Files | Acceptance Criteria |
|------|------|-------|-------------------|
| 2.1 | **Spend snapshot cron** | `services/indexer/src/crons/spend-snapshot.ts` | Reads SpendTracker via `resolveVaultState()`, writes to `spend_snapshots`, runs every 10 min |
| 2.2 | **Balance snapshot cron** | `services/indexer/src/crons/balance-snapshot.ts` | Reads token balances via `getVaultTokenBalances()`, writes to `balance_snapshots`, runs hourly |
| 2.3 | **TEE proof writer** | `services/indexer/src/crons/tee-archive.ts` | On attestation verification, writes to `tee_proofs` table |
| 2.4 | **Vault metadata API** | `services/indexer/src/api/metadata.ts` | CRUD for vault names, descriptions, agent labels |
| 2.5 | **Cron scheduler** | `services/indexer/src/scheduler.ts` | Orchestrates all crons with error handling, health checks |

### Phase 3: Arweave Archival (target: 3 days)

| Step | Task | Files | Acceptance Criteria |
|------|------|-------|-------------------|
| 3.1 | **Arweave uploader** | `services/indexer/src/archive/arweave.ts` | Uses `arweave-js` SDK directly (NOT Irys). Tags: `App-Name: Sigil`, `Type: EventArchive`, `Date: YYYY-MM-DD` |
| 3.2 | **Daily archive cron** | `services/indexer/src/crons/daily-archive.ts` | At 00:05 UTC, batches yesterday's events, uploads to Arweave, stores tx ID |
| 3.3 | **Archive verification** | `services/indexer/src/archive/verify.ts` | Fetches from Arweave gateway, compares hash against Postgres data |
| 3.4 | **Archive API** | `services/indexer/src/api/archives.ts` | List archives, get details + Arweave link, run verification |

### Phase 4: Dashboard API (target: 1 week)

| Step | Task | Files | Acceptance Criteria |
|------|------|-------|-------------------|
| 4.1 | **Activity feed** | `services/indexer/src/api/activity.ts` | Paginated, filterable by category/agent/time |
| 4.2 | **Spending history** | `services/indexer/src/api/spending.ts` | Time-series from `spend_snapshots` |
| 4.3 | **Balance history** | `services/indexer/src/api/balances.ts` | P&L chart data from `balance_snapshots` |
| 4.4 | **Audit trail** | `services/indexer/src/api/audit.ts` | Security events + TEE proofs + Arweave cross-refs |
| 4.5 | **Health endpoint** | `services/indexer/src/api/health.ts` | Pipeline lag, cron statuses, Arweave archive status |

---

## 7. Configuration

```env
# .env for services/indexer (PRIVATE — never in public repo)
HELIUS_API_KEY=                              # Helius Developer ($49/mo) or Business ($499/mo)
HELIUS_GRPC_ENDPOINT=                        # LaserStream gRPC endpoint
SIGIL_PROGRAM_ID=4ZeVCqnjUgUtFrHHPG7jELUxvJeoVGHhGNgPrhBPwrHL

DATABASE_URL=postgresql://...                # Supabase or self-hosted Postgres
DATABASE_POOL_SIZE=10

ARWEAVE_WALLET_PATH=./arweave-wallet.json    # Arweave keyfile (NEVER commit this file)
ARWEAVE_GATEWAY=https://arweave.net

NETWORK=devnet                               # devnet | mainnet-beta
SPEND_SNAPSHOT_INTERVAL_MS=600000            # 10 minutes (match SpendTracker epoch)
BALANCE_SNAPSHOT_INTERVAL_MS=3600000         # 1 hour
ARCHIVE_HOUR_UTC=0                           # Hour to run daily Arweave archive
```

---

## 8. Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@usesigil/kit` | latest (from npm) | Event decoders, state resolver, analytics functions |
| `@helius-dev/laserstream-sdk` | latest | Yellowstone gRPC client with Rust NAPI core (40x faster) |
| `pg` | ^8 | PostgreSQL client |
| `arweave` | ^1 | Arweave uploads (direct SDK, NOT Irys) |
| `cron` | ^3 | Cron scheduler |

**`@usesigil/kit` is consumed from npm, not via workspace link.** This is the clean interface between the public open-source repo and the private infrastructure repo. When the SDK publishes a new version with updated event decoders, the indexer bumps its dependency.

---

## 9. Security

| Concern | Mitigation |
|---------|-----------|
| **Private repo** | All infrastructure code, deploy configs, and CI workflows in private `sigil-infra` repo. Never in public `agent-middleware`. |
| **CI environment isolation** | Indexer deploy gets `indexer-deploy` GitHub environment. Admin deploy gets `admin-deploy`. Neither shares secrets. |
| **Arweave wallet key** | Separate wallet with minimal AR balance (~0.1 AR). Never reuse main wallet. Stored in CI environment secrets, never committed. |
| **Postgres access** | Connection pooling, SSL required, IP allowlist for production. |
| **No signing authority** | Indexer is read-only — consumes events and on-chain state. Never holds vault keypairs or program upgrade authority. |
| **Dependency firewall** | `@usesigil/kit` from npm is the only interface to the public repo. No workspace cross-links. |
| **LaserStream reconnection** | Helius 24h replay handles gaps. Dedup via unique constraint on `(signature, event_name)`. |
| **CODEOWNERS** | `.github/workflows/` changes require explicit approval. |

---

## 10. Monitoring & Alerting

| Metric | Alert Threshold | Action |
|--------|----------------|--------|
| **Pipeline lag** | >100 slots (~40 seconds) | Check LaserStream connection, reconnect |
| **Events/minute** | Drops to 0 for >5 min | LaserStream disconnected or program paused |
| **Cron failures** | 3 consecutive failures | Check RPC/Postgres connectivity |
| **Arweave archive** | Missing yesterday by 01:00 UTC | Manual trigger, check AR balance |
| **Postgres disk** | >80% capacity | Add retention policy or scale storage |
| **API response time** | P95 > 500ms | Add index or optimize query |

---

## 11. Data Retention

| Data Type | Hot Retention (Postgres) | Archive (Arweave) |
|-----------|------------------------|-------------------|
| Events | 90 days | Permanent (daily batches) |
| Spend snapshots | 1 year | Not archived (derivable from events) |
| Balance snapshots | 1 year | Not archived (derivable from chain) |
| TEE proofs | 1 year | Permanent (compliance requirement) |
| Vault metadata | Permanent | Not archived (mutable data) |
| Event archives index | Permanent | N/A (cross-reference table) |

---

## 12. Cost Projections

### At Launch (10 vaults)

| Item | Monthly Cost |
|------|-------------|
| Helius Developer | $49 |
| Supabase Free Tier | $0 |
| Arweave (~1MB/month) | $0.01 |
| Railway (indexer hosting) | $5 |
| **Total** | **~$54/mo** |

### At Scale (1,000 vaults)

| Item | Monthly Cost |
|------|-------------|
| Helius Business | $499 |
| Supabase Pro (8GB) | $25 |
| Arweave (~150MB/month) | $1.20 |
| Railway (indexer hosting) | $20 |
| **Total** | **~$545/mo** |

### At 10,000+ vaults (enterprise)

| Item | Monthly Cost |
|------|-------------|
| Helius Professional + LaserStream | $1,499 |
| Managed Postgres (64GB) | $100-300 |
| ClickHouse (OLAP, if needed) | $200-500 |
| Arweave (~1.5GB/month) | $12 |
| Fly.io/Railway (indexer) | $50 |
| **Total** | **~$1,860-2,360/mo** |

---

## 13. Council Review Summary

### Council 1: Storage Solution Selection (2026-03-24, Quick, 4 members)

| Member | Finding | Resolution |
|--------|---------|------------|
| **Architect** | Add query latency criterion | Sub-second for dashboard, archival-ok for audit |
| **Engineer** | Add migration/vendor lock-in scoring | Yellowstone gRPC portable, Postgres universal |
| **Researcher** | Clockwork dead, add Old Faithful + DAGGER | Removed Clockwork, added Old Faithful and DAGGER evaluations |
| **Security** | Add tamper-evidence / proof-of-inclusion | Arweave content hashing + on-chain cross-reference |

### Council 2: Repo Placement (2026-03-25, Full Debate, 5 members, 3 rounds)

**Round 1:** 3-2 split. Architect/Engineer/Designer advocated `packages/indexer/` in monorepo. Security/Researcher advocated separate repo.

**Round 2:** Security shifted to monorepo with strict CI environment isolation. Researcher revised after finding small-team counter-evidence (Marinade, Squads keep indexers in-repo). Designer proposed `services/` naming convention.

**Round 3:** Unanimous monorepo convergence. 3-2 split on naming (`packages/` vs `services/`). Engineer and Designer argued `services/` communicates intent (running process, not importable library).

**Post-debate constraint:** `agent-middleware` is public open-source. This changes the answer entirely — infrastructure code with secrets cannot live in a public repo. Final decision: **separate private `sigil-infra` repo** using `services/indexer/` naming convention from the debate.

**Security non-negotiables (accepted by all 5 members):**
1. Isolated CI environments per service
2. No shared service accounts
3. Indexer is read-only (no signing authority)
4. Dependency firewall via npm (not workspace link)
5. CODEOWNERS on workflow files

---

## 14. Open Questions

1. **Supabase vs. self-hosted Postgres?** Supabase free tier works for launch. Decision point: >50 connections or >500MB storage.
2. **TEE proof archival frequency?** Current plan: archive individually. Alternative: batch daily like events.
3. **Indexer hosting?** Railway (simplest), Fly.io (closest to Postgres), or Docker on a VPS.
4. **Historical backfill?** Use Old Faithful or Helius `getTransactionsForAddress`. Budget ~$50 in Triton credits.
5. **When to create `sigil-infra` repo?** Before any implementation begins. The admin dashboard also lives here.

---

## 15. Success Criteria

- [ ] All 31 Sigil event types captured and decoded in real-time
- [ ] Event pipeline lag < 100 slots (~40 seconds) during normal operation
- [ ] Spend history available for >24h (beyond on-chain circular buffer)
- [ ] Balance snapshots enable P&L charts over 30+ day periods
- [ ] TEE attestation proofs persisted beyond in-memory TTL
- [ ] Vault metadata (names, descriptions, agent labels) stored and retrievable
- [ ] Daily Arweave archives with verifiable content hashes
- [ ] Dashboard API returns activity feed in <200ms P95
- [ ] Total cost <$100/mo at launch
- [ ] All infrastructure code in private repo, zero secrets in public repo

---

## Appendix A: SDK Functions to Import (DO NOT REBUILD)

These are published in `@usesigil/kit` on npm. Import them in the indexer, do not reimplement.

| Function | Purpose |
|----------|---------|
| `parseSigilEvents(logs)` | Extract raw events from tx logs |
| `parseAndDecodeSigilEvents(logs)` | Parse + decode with typed fields |
| `categorizeEvent(name)` | Map event to category (trade/deposit/etc) |
| `describeEvent(decoded)` | Human-readable event description |
| `resolveProtocolName(address)` | Protocol address to name |
| `resolveVaultState(rpc, vault)` | Batch-fetch all vault PDAs |
| `getSpendingHistory(tracker, slot)` | Circular buffer to time-series |
| `getVaultTokenBalances(rpc, vault)` | Current token balances |
| `getVaultPnL(rpc, vault)` | Lifetime P&L from on-chain counters |
| `resolveVaultStateForOwner(rpc, owner)` | Discover all vaults for owner |
| `getAuditTrail(events)` | Events to audit entries |
| `getVaultHealth(state)` | Health assessment from state |
| `getVaultSummary(rpc, vault)` | One-call everything for vault detail |

## Appendix B: Event Types by Category

| Category | Events | Count |
|----------|--------|-------|
| **trade** | ActionAuthorized, SessionFinalized, DelegationRevoked, AgentTransferExecuted, AgentSpendLimitChecked, PositionsSynced | 6 |
| **deposit** | FundsDeposited | 1 |
| **withdrawal** | FundsWithdrawn | 1 |
| **policy** | PolicyUpdated, PolicyChangeQueued, PolicyChangeApplied, PolicyChangeCancelled, InstructionConstraintsCreated, InstructionConstraintsUpdated, InstructionConstraintsClosed, ConstraintsChangeQueued, ConstraintsChangeApplied, ConstraintsChangeCancelled | 10 |
| **agent** | AgentRegistered, AgentRevoked, AgentPermissionsUpdated, AgentUnpausedEvent | 4 |
| **security** | VaultCreated, VaultFrozen, VaultReactivated, VaultClosed, AgentPausedEvent | 5 |
| **fee** | FeesCollected | 1 |
| **escrow** | EscrowCreated, EscrowSettled, EscrowRefunded | 3 |
| **Total** | | **31** |
