---
"@usesigil/kit": minor
---

refactor(sigil): delete `is_spending` byte from ConstraintEntry (M2 Option A)

The `is_spending: u8` field on `ConstraintEntry` was effectively dead
code at runtime — `validate_and_authorize.rs:134` derives spending
classification from `amount > 0`, never reading the per-entry field.
The Borsh-struct field is removed; the corresponding zero-copy byte
at offset 554 is renamed to `_reserved_was_is_spending` to preserve
the 560-byte `ConstraintEntryZC` size invariant. Existing on-chain
PDAs are unaffected (the byte is now ignored runtime-wide).

**Side effect / latent fix:** 21 previously-broken tests in
`tests/instruction-constraints.ts` now pass (29→50). They were
failing because they constructed entries without the `is_spending`
field, hitting the now-removed validator at `state/constraints.rs:309-312`.

**Codama regen impact:** `sdk/kit/src/generated/types/constraintEntry.ts`
no longer has `isSpending: number`; codama also produced 16 new
PDA-derivation helpers in `sdk/kit/src/generated/pdas/` (unrelated
positive cosmetic refactor from the regen).

**Coordination with PR 9** (`feat/sigil-account-constraint-writable-required`):
PR 9 was branched off this PR; merge order is mandatory **PR 8 → PR 9**
to avoid `state/constraints.rs` conflict. PR 9 has been pre-rebased
locally onto this PR's amend (Jupiter slippage non-spending bypass fix).

**Follow-up amend on this branch (`a24d0a2`):** closes a Pentester MED
finding — the non-spending forward scan in `validate_and_authorize.rs`
was missing the `verify_jupiter_slippage` call. Now `enforce_jupiter_slippage_if_jupiter`
is called from BOTH spending and non-spending forward-scan branches.

No SDK API surface change. The `ConstraintEntry` Borsh layout shrinks
by 1 byte at the encoder level; codama-generated codecs handle this
transparently for all consumers.
