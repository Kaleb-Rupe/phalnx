---
"@usesigil/kit": patch
---

Phase 1 SDK convenience layer (trivial items):

- **S19** — Export `toUsdNumber` (renamed from private `usdToNumber`) and add inverse `fromUsdNumber` with NaN/Infinity `TypeError` guard plus magnitude `RangeError` guard at the documented precision ceiling. Also export `FROM_USD_NUMBER_MAX` so consumers can pre-validate without redefining the constant. `toUsdNumber` now throws `RangeError` on negative input to make its "non-negative" precondition a runtime contract instead of a docstring-only hint.
- **S5** — Replace 5 `:any` callback params in `dashboard/reads.ts` with concrete types (`SecurityCheck`, `Alert`, `SpendingBreakdown["byProtocol"][number]`, `unknown`).
- **S7** — Add optional `type?: ActivityType` filter to `ActivityFilters`; applied in `getActivity`. Also fixes the post-ActionType-elimination silent-failure where `mapCategory` could not produce `open_position`/`close_position` for v6 events: `positionEffect` is now plumbed through and used as the primary discriminator.
- **S8** — Add client-side bounds validation to `queuePolicyUpdate`: `approvedApps.length ≤ MAX_ALLOWED_PROTOCOLS` and `maxConcurrentPositions` via existing `requireU8` (0-255, on-chain u8 type). New `MAX_ALLOWED_PROTOCOLS` constant exported from the SDK's main entry.

**S8 scope note:** Pre-validation intentionally covers only these 2 fields plus existing `timelock`/`dailyCap`/`maxPerTrade`/`developerFeeRate` checks. Other bounded `queuePolicyUpdate` fields (`allowedDestinations` length, `protocolCaps` length-match with protocols, `maxSlippageBps`, `sessionExpirySlots` range) remain on-chain-only — the SDK JSDoc now enumerates which fields are pre-validated vs on-chain-only.

**Tests added:** 7 queuePolicyUpdate validation tests (approvedApps length boundary both sides, maxConcurrentPositions u8 overflow / negative / non-integer / boundary), 1 toUsdNumber negative-guard test, 1 fromUsdNumber exact-boundary RangeError test.
