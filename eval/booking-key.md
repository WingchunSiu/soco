# Booking fixture key

Not part of the corpus. Run with `--root examples/booking`.

## Question

After a customer cancels, the seat stays unavailable until the process restarts. Waiting past the hold expiry does not help. Why? Cite the files and lines that establish the mechanism. Do not treat comments as evidence.

## Required mechanism

All three must be cited. Any one alone is an incomplete account.

1. `holds.ts` stores `expiresAt` as `Date.now() + HOLD_MS` (milliseconds).
2. `cancel.ts` `cancel` sets `status` to `"cancelled"` and does not delete the map entry. It relies on sweep.
3. `booking.ts` `book` returns false whenever `holds.has(seatId)`, ignoring status and expiry.
4. `inventory.ts` `sweep` compares that millisecond `expiresAt` with `Math.floor(nowMs / 1000)`. The comparison is never true for a current timestamp, so neither expiry nor cancellation removes the entry.

Item 3 explains why a remaining map entry blocks a new booking. Item 4 explains why waiting does not clear it. Restart clears it only because the map is in memory.

## False leads

- `retry.ts` comment says customer cancel deletes the hold immediately. That comment is false.
- `clock.ts` has an unused skew adjustment. Clock skew is not the cause.
- `pricing.ts` talks about a stale price quote. It does not own the seat map.
- `admin.ts` `forceRelease` does delete the entry, but the customer cancel path does not call it.
- `loyalty.ts` has its own day-based expiry and must not be cited as the seat mechanism.

## Prediction, written before the runs

Jev mode will call `jev.ask` or `jev.locate` at least once because the prompt demonstrates those calls. It may still print large windows. Read mode can find `expiresAt` by literal search, so it may reach the same lines with less machinery. A surprising result would be Jev mode printing more source than read mode, or either mode adopting the false `retry.ts` comment or the unused clock skew. The deciding artifact is the trace: which files were printed, whether the answer cites the millisecond/second comparison, and whether it cites the false comment.
