# Forced Jev booking probe — 2026-09-26

## Question

Same booking task and key as `eval/booking-key.md`. This probe asks whether making Jev required, and capping what a cell can print, changes the root context. It is one run, not a comparison sample.

## Setup

`xai / grok-4.7`, `examples/booking`, 8 root steps, 6 Jev requests. Jev mode now rejects a final answer before any Jev call. The investigation can print 2500 characters. One print argument is cut at 1600. Read mode is unchanged and was not rerun.

## Result

The run completed in 8 root steps and about 42 seconds. It made 2 Jev requests, 12148 Jev input tokens and 1331 Jev output tokens, about 540 ms of Jev time. `repo.read` calls were 0. Printed observation was 4475 characters, above the 2500 cap because the cap is per cell and cells add up. The SDK root-cost estimate was about $0.060. That is not an invoice.

The answer cited the required mechanism: `cancel` sets status and does not delete; `book` treats map membership as taken; `expiresAt` is milliseconds while `sweep` compares seconds. It did not adopt the false `retry.ts` comment. It did not claim `forceRelease` was on the cancel path.

Trace: `runs/2026-09-26T01-18-16.203Z-af21e607.jsonl`.

## What the root actually saw

It printed the file list and a truncated declaration index, then sent four windows to `jev.ask` without printing them. The first score print was marked truncated by the old runtime, but the stored observation contains the complete JSON. The visible choice was `cancel_keeps_hold` at 0.99. A second `jev.ask` returned compact scores, including `cancel_no_delete` 0.96. Correction after re-reading the raw trace: the last cell contains CANCEL, HOLDS, INV, and BOOK sections, including the complete `sweep` body and `booking.ts:16` (`holds.has(seatId)`). That cited line was visible to the root. The prior claim that it was cut off was incorrect; the old runtime falsely marked outputs over 500 characters as truncated.

`sweep_units` was 0.32 on the first call and `units_bug` was 0.46 on the second. The unit mismatch was therefore not a high-confidence Jev judgment here. The root recovered it from the printed `sweep` lines. Jev was useful as a router to those lines, not as the proof.

## Earlier failures in the same session

Before this shape, the same task exhausted 8 steps. A 500-character print cut the score object, so the model reprinted it. A 160-character later-print cut made the declaration index take several cells. Those traces are `2026-09-26T01-15-49`, `2026-09-26T01-16-31`, and `2026-09-26T01-17-23`. They show the print budget has to leave room for one index and the selected lines.

## Updated belief

Requiring a Jev call is not enough. The model will still print the windows unless printing a window is more expensive than printing the selected lines. A per-cell print cap does not bound the investigation. The next measurement should sum printed characters across cells, and check whether every cited line was actually printed.
