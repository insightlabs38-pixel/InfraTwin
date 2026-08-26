# Level 3 optimizer benchmark

Run with:

```bash
npm run benchmark:level3
```

The benchmark solves three fixed browser-equivalent HiGHS cases under Node 22:

- Growth Wall traffic-allocation LP.
- Growth Wall +40% minimum-cost capacity MILP at an 80% utilization target, followed by independent verification.
- Resilience Gap minimum-cost mitigation for its deterministic worst N-1 link failure at the same target.

CI is the authoritative environment because it installs the pinned `highs` package and its WASM asset. Expected deterministic decisions are G2 → 22 Gbps at cost 6 for Growth Wall and R4/R5 → 14 Gbps each at total cost 8 for the Resilience Gap R2 failure. Runtime is reported for observability but is not used as a correctness assertion.
