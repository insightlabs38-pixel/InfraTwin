# InfraTwin final demo source-scene capture plan

Product baseline: `9aa939a4cec5774f2fb0d95cbd2905ac653e480e`

This capture package is intentionally modular. The final video should be edited from these takes only after the footage has been reviewed. Every scene uses genuine product state; native WebMCP scenes execute through `document.modelContext`; deterministic analysis/optimization remains product-computed.

| # | Scene | Editing role |
|---:|---|---|
| 01 | Clean hero workspace | Establish finished product quickly |
| 02 | Human selects maintenance link | Begin the operator story |
| 03 | Human schedules outage | Show human-authored ChangePlan mutation |
| 04 | WebMCP inspects selection | Prove shared live browser state |
| 05 | Agent adds Payments growth | Prove human + agent coauthor one ChangePlan |
| 06 | Analyze remote failure | Deterministic falsification / cold-open material |
| 07 | Inspect remote evidence | Make the unexpected corridor failure concrete |
| 08 | Initial mitigation | Show proposal, not automatic application |
| 09 | Human locks proposed link | Operational judgment changes allowed design space |
| 10 | Proposal stale transition | Show stale-state safety immediately |
| 11 | WebMCP adaptive replan | Hero collaboration / replan sequence |
| 12 | Current FAIL + proposed VERIFIED | Hold the central decision state cleanly |
| 13 | Verification evidence detail | Trust model / independent verification |
| 14 | 500-node scale | Establish meaningful browser scale and worker execution |
| 15 | Native WebMCP diagnostics | Concise technical proof for judges |

## Capture rules

- 1920×1080, 30 fps, H.264, yuv420p, silent.
- Record setup before `markStart`; processed footage begins at the useful trim point.
- Preserve roughly 1–2 seconds before the main visible action and 3–6 seconds after the useful end state.
- Author scene holds with explicit margin above the validated minimum duration so trim/encoding variance cannot turn a good take into a boundary failure; scene 01 carries an extra final-state hold for the submission recapture.
- Current deterministic evidence is shown only for a current PASS/FAIL analysis (or an explicit counterexample replay). A DRAFT/STALE plan must not visually inherit prior violation cards, analyzed load/utilization values, or stale topology violation highlighting.
- Final visual QA must explicitly inspect the pre-analysis agent-growth state for a clean DRAFT presentation before using scene 05 in the submission edit.
- Do not fabricate agent UI, product results, tool activity, engineering numbers, or optimizer state.
- Do not accelerate compute in capture. Final editing may hard-cut irrelevant waiting, but may not imply a slower operation completed instantly.
- Keep the product at normal 100% browser zoom.
- Keep cursor movement deliberate and restrained.
- Final narration is written after reviewing these source takes, not before.
