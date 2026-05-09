---
"@usesigil/kit": minor
---

feat(kit): buildUnsigned() composer for offline signing (S21)

A new public composer that builds an unsigned Solana transaction from
plain instructions and a `feePayer: Address` (no `TransactionSigner`
required). Fills the gap between `buildOwnerTransaction` (requires a
signer) and the multisig / CLI / cost-preview use cases that need raw
unsigned bytes.

**API**

```typescript
import { buildUnsigned } from "@usesigil/kit";

const result = await buildUnsigned({
  rpc,
  feePayer: payerAddress,
  instructions,
  // Optional:
  computeUnitLimit,
  computeUnitPrice,
  addressLookupTables,
  blockhash,
  simulate: true, // populates estimatedComputeUnits
});

result.unsignedTxBytes;        // Uint8Array — ready for offline signer
result.instructions;           // by-reference (do not mutate)
result.estimatedComputeUnits;  // present iff simulate=true succeeded
result.feePayer;
result.recentBlockhash;
result.lastValidBlockHeight;
result.message;                // decoded compiled message for inspection
```

**Three primary use cases**

1. **Squads multisig** — submit `unsignedTxBytes` as a Squad proposal;
   signers from the multisig sign asynchronously.
2. **CLI cold-key signing** — pipe the buffer to `solana sign-tx` for
   offline signing.
3. **Client-side cost preview** — caller decodes the buffer / reads
   `estimatedComputeUnits` to estimate CU + fee before submission.

**How this differs from `buildOwnerTransaction`**

- `buildOwnerTransaction` requires a `TransactionSigner` for the owner;
  `buildUnsigned` accepts a plain `Address` (uses `createNoopSigner`
  internally).
- `buildOwnerTransaction` returns `{ transaction, txSizeBytes,
  wireBase64, blockhash }`; `buildUnsigned` returns `unsignedTxBytes`
  (decoded) + the original `instructions[]` + a decoded `message`
  for inspection.

11 unit tests cover wire layout, decode round-trip, simulate behavior,
and signature-slot zeroing.
