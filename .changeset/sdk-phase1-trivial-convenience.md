---
"@usesigil/kit": patch
---

Phase 1 SDK convenience layer (trivial items):

- **S19** — Export `toUsdNumber` (renamed from private `usdToNumber`) and add inverse `fromUsdNumber` with NaN/Infinity guard. Round-trip safe for |value| ≤ ~$9B.
- **S5** — Replace 5 `:any` callback params in `dashboard/reads.ts` with concrete types (`SecurityCheck`, `Alert`, `SpendingBreakdown["byProtocol"][number]`, `unknown`).
- **S7** — Add optional `type?: ActivityType` filter to `ActivityFilters`; applied in `getActivity`.
- **S8** — Add client-side bounds validation to `queuePolicyUpdate`: `approvedApps.length ≤ MAX_ALLOWED_PROTOCOLS`, and `maxConcurrentPositions` u8 check via existing `requireU8`. New `MAX_ALLOWED_PROTOCOLS` constant exported.

**S8 scope note:** Pre-validation is intentionally limited to the 2 fields in scope. Other bounded `queuePolicyUpdate` fields (`allowedDestinations` length, `protocolCaps` length-match with protocols, `maxSlippageBps`, `sessionExpirySlots` range) are still enforced on-chain only — validating all of them symmetrically is deferred to a follow-up. Until then, on-chain remains the source of truth for those fields.
