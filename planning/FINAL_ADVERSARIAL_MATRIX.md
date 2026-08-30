# InfraTwin Final Adversarial Validation Matrix

**Status:** IN PROGRESS — DO NOT FREEZE

## Frozen baseline

- Final merged Level 4B commit: `fcf4d2f2b4ea9b43b5e0714695767a41148f575b`
- Baseline permanent CI run: `33331431439` — SUCCESS
- Baseline unit tests: 131/131 passed
- Standard Chromium E2E: 44 passed, 2 native-only tests skipped in this lane
- Native Chromium WebMCP: 2/2 test cases reported passed, but the logs contain repeated unhandled `InvalidStateError: Duplicate tool name`; this is tracked below as a real adversarial finding rather than treated as clean native-host behavior.
- Source snapshot artifact: `9737748197` (`5ad85222c443468c93f66033dbf8f719444a0a8fef8512a99c9a6c7eca8cd861`)
- Native/browser inspection artifact: `9737785330` (`77a8fb3cd3d18511ddc94af43aec6ab022d10a7f955be945e730b30f1af01ec5`)
- Scale artifact: `9737819061` (`beab96f736f176afa397920124d82094c4599102cd9ea9f84194c3a39e51f732`)
- Level 4 design/scale artifact: `9737832877` (`95e0b241b423723efcb62e5b5c5e8a39f2a80edef0d66add5ab81b7d586b5103`)

### Frozen Level 4B performance class

| Tier | Nodes / Links / Demands | Level 4A path-gen | Level 4B path-gen | Speedup | Warm reuse | Approx retained cache |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| A | 128 / 304 / 96 | 4731.2 ms | 427.3 ms | 11.07× | 12.7 ms | 0.61 MiB |
| B | 250 / 600 / 200 | 41262.5 ms | 3114.0 ms | 13.25× | 41.2 ms | 2.44 MiB |
| C | 500 / 1200 / 400 | 354587 ms | 29710 ms | 11.93× | 146.3 ms | 9.56 MiB |

The pass must preserve this approximate performance class; exact milliseconds are not an acceptance criterion.

## Severity policy

- **P0:** engineering truth / safety violation.
- **P1:** wrong authoritative state or serious workflow corruption.
- **P2:** misleading UI/evidence or recoverable failure.
- **P3:** cosmetic/minor; defer unless trivial.

## Discovered findings

| Finding | Attack / failure scenario | Target subsystem | Invariant | Expected behavior | Observed baseline behavior | Severity | Fix commit | Regression test |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-001 | Construct two semantically different Level 4B topology states with the same 32-bit topology digest, prime cache with topology A, then request topology B | Level 4B graph/path cache | Cache cannot reuse semantically invalid path data | Cache identity must distinguish all route-semantic states even if a display digest collides | **FAIL:** graph cache is keyed by `fnv1a32` digest only. A demonstrated collision (`fnv1a32:f9273ceb`) can make a directed A→B→C topology and a semantically different C→B topology share the same graph cache entry, allowing wrong paths | **P1** | pending | pending |
| F-002 | Native WebMCP state refreshes overlap while dynamic capabilities are registering | WebMCP dynamic registration / Strict Mode | Revoked/current capabilities only; no duplicate native registrations | Registration refresh must be serialized/owned and must not emit duplicate tool registrations or unhandled rejections | **FAIL:** final merged baseline native Chromium logs contain repeated unhandled `InvalidStateError: Duplicate tool name` while the tests still report green | **P1** until impact re-test | pending | pending |

## Adversarial campaign

Every row targets at least one explicit product invariant. `PENDING` means the case has not yet been closed by reviewed evidence; it does not imply failure.

| ID | Attack / failure scenario | Target subsystem | Invariant / expected behavior | Observed | Severity | Fix commit | Regression / proof |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AV-03A-F | Analysis starts, then plan/constraint/lock/import/example/reset changes | Analysis authority | Old result may finish internally but never becomes current evidence | PENDING | — | — | pending |
| AV-04A-F | Capacity/adaptive optimizer starts, then lock/budget/restriction/action/catalog/network changes | Optimizer publication | Stale candidate never becomes current or decidable | PENDING | — | — | pending |
| AV-05 | Safe Level 4B reuse: bandwidth/budget/utilization/Pareto target | Path cache | Reuse must equal cache-disabled/reference execution | PENDING | — | — | pending |
| AV-05B | Unsafe reuse attempts: link/node outage, weight, forbidden link/node, candidate add/remove/weight, topology replacement, direction | Path cache | Every route-semantic change must invalidate | F-001 demonstrates key risk | P1 | pending | pending |
| AV-06 | Cache collision / key completeness including delimiter-like IDs, K/diversity, candidate semantics and routing restrictions | Path cache | No two route-semantic states may share cache identity | F-001 confirmed | P1 | pending | pending |
| AV-07 | Rapid start/cancel loops for analysis, N-1, capacity/adaptive optimizer and path generation | Workers / cancellation | Latest invocation only; no orphan, stale progress, resource growth or stuck running state | PENDING | — | — | pending |
| AV-08 | Human + agent concurrent plan edits/analyze/verify | Shared application service | Valid coactivity survives deterministically; computation maps to one semantic revision, never a hybrid | PENDING | — | — | pending |
| AV-09 | Modify locked link/node via UI, WebMCP, optimizers, proposal acceptance, candidate links and direct service calls | Human locks | No path silently modifies protected infrastructure; locked ≠ unavailable | PENDING | — | — | pending |
| AV-10 | Bypass forbidden routing links/nodes via shortest/alternate/candidate/scenario/cache/Pareto | Adaptive routing restrictions | No verified allocation includes forbidden resources | PENDING | — | — | pending |
| AV-11 | Create proposal then mutate plan/constraint/lock/restriction/catalog/candidate options and attempt direct acceptance | Proposal lifecycle | Semantically stale proposal becomes undecidable and direct acceptance fails | PENDING | — | — | pending |
| AV-12 | VERIFIED then semantic edit vs pure presentation edit | Verification freshness | Semantic edit ⇒ STALE immediately; pan/zoom/selection/navigation remain current | PENDING | — | — | pending |
| AV-13 | Bounded/cancelled/partial/complete N-1 wording | N-1 evidence | Partial coverage cannot appear complete; tested/eligible counts explicit | PENDING | — | — | pending |
| AV-14 | N-1 zero/one/exact-limit/limit+1/already-disabled/disconnected/zero-demand/all-unreachable | N-1 engine | No divide-by-zero/empty assumptions; truthful ranking/evidence | PENDING | — | — | pending |
| AV-15 | ECMP huge exact counts, >MAX_SAFE_INTEGER, truncation, diamonds, unreachable, directed asymmetry | Routing evidence | Exact string count truthful; numeric convenience/truncation never lies | PENDING | — | — | pending |
| AV-16 | Small positive weights, huge legal capacities, target ± epsilon, zero demand, duplicate equal-cost paths | Numeric boundaries | Stable tolerance semantics; no false PASS/FAIL | PENDING | — | — | pending |
| AV-17 | Malformed JSON/CSV: duplicate IDs/headers, unknown refs, self-links, NaN/Infinity, negatives, zero weight, huge strings/depth/rows, malformed CSV, missing/extra fields | Import validation | Clear rejection/defaults; no partial canonical import | PENDING | — | — | pending |
| AV-18 | Import fails on a late row | Atomic import | Existing NetworkProject/ChangePlan remain unchanged | PENDING | — | — | pending |
| AV-19 | Prompt-injection/HTML/script-looking imported strings | Data / UI / WebMCP | Rendered/returned as untrusted inert data; no mutation/capability execution/XSS | PENDING | — | — | pending |
| AV-20 | Direct malformed WebMCP handler inputs: wrong primitive types, objects in arrays, huge/negative K, NaN-like, invalid kind/IDs, extra/nested malformed values | WebMCP semantic layer | Shared layer rejects invalid input independent of JSON Schema | PENDING | — | — | pending |
| AV-21 | Rapid no-analysis→FAIL→edit→FAIL→proposal→stale transitions | Dynamic WebMCP capability lifecycle | Exactly-once registration; revoked tools disappear; no duplicate/old registrations; revoked execution fails | F-002 confirmed duplicate-registration failure | P1 | pending | pending |
| AV-22 | Native Strict Mode mount/unmount/remount | Native WebMCP | Zero duplicate registrations; cleanup guaranteed; current origin cluster correct | F-002 confirmed baseline error | P1 | pending | pending |
| AV-23 | Enumerate final WebMCP-visible capabilities and lower-level internals | Canonical apply safety | No agent capability silently deploys/commits/applies candidate/bypasses human approval | PENDING | — | — | pending |
| AV-24 | Simulate optimal/infeasible/time-limit incumbent/no-incumbent/error/malformed/cancelled solver statuses | Solver truth | OPTIMAL only with proof; TIME_LIMIT not optimal; VERIFIED only after reconstruction | PENDING | — | — | pending |
| AV-25 | Tamper solver candidate: wrong cost/path flow/capacity/lock/conservation/scenario | Independent verifier | Reject every inconsistent primal; no VERIFIED badge remains | PENDING | — | — | pending |
| AV-26 | All routes forbidden/disconnected/candidates disabled/only candidate locked/K=1 no alternate | Adaptive no-path | Truthful failure reason, not blanket budget-infeasible | PENDING | — | — | pending |
| AV-27 | Malformed candidate links: bad endpoint/self/id collision/negative cost/zero capacity/bad weight/locked/forbidden/duplicate ID | Candidate-link safety | Reject; optimizer never invents/repairs malformed options | PENDING | — | — | pending |
| AV-28 | Dominated/identical/equal-cost/equal-headroom/infeasible Pareto points | Pareto frontier | Deterministic, unique, nondominated, all displayed variants verify | PENDING | — | — | pending |
| AV-29 | Scenario loop immediate/multi-iteration/repeated-worst/no-new/iteration-limit/time-limit/cancel/infeasible | Scenario generation | No infinite loop; correct termination reason | PENDING | — | — | pending |
| AV-30 | Blank network: analyze/N-1/optimize/adaptive/WebMCP/selection/search | Empty state | Explicit empty result; no crash | PENDING | — | — | pending |
| AV-31 | Immediately below/at/above renderer, Worker, N-1, adaptive-variable, binary and canonical limits | Product scale guards | No off-by-one behavior | PENDING | — | — | pending |
| AV-32 | Tier C zoom/pan/search/select/navigation/cancel during analysis | Large-network UX | UI remains responsive; no stale selection/inspector/crash | PENDING | — | — | pending |
| AV-33 | Cross-check topology/Inspector/Analysis/WebMCP/export evidence | Evidence consistency | Same selection/utilization/violation/freshness/proposal state everywhere | PENDING | — | — | pending |
| AV-34 | Search for duplicate authoritative project/plan/analysis/proposal/verification/selection state | Source-of-truth audit | No demonstrated correctness risk from parallel authority copies | PENDING | — | — | pending |
| AV-35 | Audit async callbacks capturing stale project/plan/hash/proposal/locks/view | React stale closures | Publication-time semantic authority checks protect every async result | PENDING | — | — | pending |
| AV-36 | Force exceptions in every long-running operation | Error recovery | Leave running state, bounded error, retry possible, previous valid evidence preserved where appropriate | PENDING | — | — | pending |
| AV-37 | Reload/reset | State reconstruction | No mixed project/plan/proposal; WebMCP reconstructs; persistence behavior documented | PENDING | — | — | pending |
| AV-38 | Rapid Analyze/Optimize×5; Accept/Reject/Lock/Outage×2 | Repeated actions | Idempotent or deterministic validation; no duplicate semantic rows | PENDING | — | — | pending |
| AV-39 | Human/WebMCP/optimizer/accept/invalidation provenance sequence | History | Actor attribution is correct and immutable | PENDING | — | — | pending |
| AV-40 | Semantic vs presentation hash mutation/repeatability | Semantic hashes | Meaningful changes alter intended hashes; presentation state does not | PENDING | — | — | pending |
| AV-41 | Equivalent semantic state with different insertion/order history | Hash ordering | Order-independent semantics hash equally; order-sensitive plan execution is documented/tested | PENDING | — | — | pending |
| AV-42 | Full flagship human outage→agent growth→analysis→N-1→mitigation→lock→adaptive→frontier→verify→stale→rerun | Cross-feature workflow | No inconsistent state at any stage | PENDING | — | — | pending |
| AV-43 | Native Chromium: malicious label, agent mutation+human override, revoked execution, lock→adaptive, stale verification | Native WebMCP red team | Same safety invariants hold on actual host, not only mock harness | F-002 must be fixed first | P1 | pending | pending |
| AV-44 | Re-run exact performance workloads after fixes | Performance regression | Preserve sub-second/few-second/tens-of-seconds Level 4B class | PENDING | — | — | pending |
| AV-46 | Search user-controlled strings through SVG/Canvas/Inspector/Analysis/history/WebMCP and unsafe HTML/URL APIs | XSS/security | No unsafe rendering or URL construction | PENDING | — | — | pending |
| AV-47 | Legal awkward inputs: long IDs/metadata/high-degree/equal-cost/many same-pair demands | Resource exhaustion | Compute guards respected; recoverable; no accidental pathological leak | PENDING | — | — | pending |

## Closure rule

A row is closed only after code review plus executable evidence. P0/P1 findings must be fixed before submission. P2 is fixed when low/medium risk; otherwise it is documented explicitly. P3 is generally deferred. Every code fix requires a direct regression test and the relevant prior suite; the final pass additionally reruns the complete permanent quality gate and native Chromium evaluation.
