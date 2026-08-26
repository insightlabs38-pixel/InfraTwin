# Level 3 hardening status

This pass freezes the existing Level 0–3 computational scope and hardens product experience, state mutation boundaries, provenance, WebMCP contracts, and browser-level regression coverage. It intentionally does **not** add any Level 4 capability.

## UI / product-quality changes

- The default workflow is now presented as an explicit engineering decision journey: **test → topology → PASS/FAIL → why → candidate/verify/apply**.
- Scenario selection, decision summary, and topology rendering are separated into focused presentation components instead of living entirely inside the Workbench controller.
- The topology remains the visual center of the application. Link clicks select evidence; semantic edits are explicit controls rather than surprising click-to-disable mutations.
- FAIL state, bottleneck evidence, candidate state, before/after comparison, and VERIFIED state receive stronger visual hierarchy.
- Advanced routing/compute assumptions and the WebMCP/agent activity inspector use progressive disclosure instead of competing with the primary workflow.
- Loading, running, cancellation, unsupported WebMCP, optimizer error, empty project, and stale-result discard states remain visible and explicit.
- Responsive layout rules keep the topology and primary scenario controls usable at desktop and narrower viewport sizes.

## Architecture / mutation changes

- Human `set_link_availability`, `set_link_capacity`, and `set_demand_bandwidth` edits now pass through the same validated `ModelCommand` / `applyModelCommand` layer used by candidate mutations.
- Reset, scenario switching, and semantic edits abort in-flight direct analyses and optimizer work before clearing derived state.
- Direct N-1 execution no longer silently replays the worst contingency; ranking and replay are separate user actions.
- UI optimizer/routing/verification publication checks the current semantic model/scenario identity before publishing an asynchronous result.
- Candidate stale checks and exact reversible apply/undo behavior remain intact.

## Semantic hashing / provenance

- `modelHash()` now represents **semantic engineering identity** using canonical stable serialization plus SHA-256.
- Node `x`/`y` coordinates and presentation-only metadata keys (`ui`, `layout`, `presentation`, `viewport`, `canvas`, `positions`, `nodePositions`) are excluded from semantic identity.
- `projectDocumentHash()` separately hashes the full serialized document, including layout/presentation state.
- `semanticModelHashWebCrypto()` provides a Web Crypto SHA-256 implementation and is tested against the deterministic synchronous implementation used by existing Level 0–3 code paths.
- Existing evidence and stale-result guards continue to call `modelHash()`, so moving a node does not invalidate valid engineering evidence while real topology/demand/capacity changes still do.

## WebMCP contract corrections

- `simulate_change` is genuinely read-only: it returns deterministic what-if evidence without changing the active shared scenario or canonical project.
- `run_contingencies` publishes the derived ranking but does not implicitly replay the worst failure.
- `show_counterexample` is split into its own dynamic registration group and is only exposed when a valid completed contingency ranking exists.
- Generic FAIL state exposes only `inspect_violation` and `find_bottlenecks`.
- Tool outputs that can contain imported/user-controlled network identifiers, names, labels, or metadata are annotated with `untrustedContentHint: true`.
- Registration groups continue to use AbortSignal lifetimes; tests verify revocation.
- Execution cancellation and stale optimizer publication guards are explicitly covered.
- The tool surface remains semantic engineering APIs; no DOM-oriented capability is exposed.

## Browser E2E coverage

Playwright Chromium coverage exercises:

- **Maintenance Trap:** baseline PASS → maintenance FAIL → L3 bottleneck evidence → reset baseline.
- **Growth Wall:** +40% violation → minimum-cost HiGHS candidate G2 20→22 Gbps / cost 6 → verify → apply → undo → semantic identity restoration.
- **Resilience Gap:** N-1 ranking → R2 worst case → explicit replay → R4/R5 10→14 Gbps / cost 8 candidate → verify → candidate remains unapplied until approval.
- import/export and imported reset;
- cancellation on a larger deterministic browser-local model;
- reset and scenario switch while analysis is active;
- stale result non-publication after shared state changes;
- HiGHS WASM worker startup;
- desktop and narrow viewport overflow/topology usability smoke checks.

Run with:

```bash
npm run test:e2e
```

## Known remaining limitations

- Browser E2E currently targets Chromium, which is appropriate for the current WebMCP/Chrome challenge surface but is not a cross-browser compatibility claim.
- Semantic metadata filtering is intentionally conservative and key-based; future schema evolution should make presentation metadata a first-class typed namespace instead of expanding an implicit deny-list indefinitely.
- Independent candidate verification remains browser-local and deterministic; the optional Vercel/Python verifier is still intentionally not required.
- The hardening suite is deterministic regression coverage, not a fuzzing, property-based, malicious-input, prompt-injection, or adversarial concurrency campaign.
- The current Level 0–3 size limits remain the browser safety boundary; this pass does not introduce Level 4 large-ensemble or N-2 scaling behavior.

## Next stage

If the complete unit/type/build/E2E/benchmark gate stays green after review and merge, the repository is ready for the **dedicated adversarial / fuzz / evaluation pass**. That adversarial pass is the next stage before any Level 4 work begins.

This document does **not** claim that adversarial hardening has already been completed.
