# InfraTwin final demo — edit decision list

| # | Final timeline | Source | Source in → out | Speed | Crop / framing | Overlay | Narration |
|---:|---|---|---|---:|---|---|---|
| 1 | 0:00.000–0:03.000 | Generated title card | — | 1.00× | Full 1920×1080, ~2% restrained motion | InfraTwin / Plan network changes before production. | No VO; opening beat |
| 2 | 0:03.000–0:10.000 | Generated problem card | — | 1.00× | Full frame | Maintenance + traffic → remote failure | “Network changes rarely fail…” |
| 3 | 0:10.000–0:15.733 | `01-opening-workspace.mp4` | 0:00.000–0:05.433 | **0.95×** | Full frame | Browser-native network decision twin | “InfraTwin lets an engineer…” |
| 4 | 0:15.733–0:25.733 | Generated Diagram A | — | 1.00× | Four 2.5 s staged reveals | **SAME LIVE CHANGE PLAN** | “The key is WebMCP…” |
| 5 | 0:25.733–0:42.367 | `02-human-agent-plan.mp4` | 0:00.000–0:16.633 | 1.00× | Full frame | HUMAN, then AGENT via WebMCP | “The engineer takes…” |
| 6 | 0:42.367–0:53.233 | `03-failure-evidence.mp4` | 0:00.000–0:10.867 | 1.00× | 35,20,1850×1040 → 1920×1080 | Deterministic result — not model inference | “InfraTwin then runs deterministic…” |
| 7 | 0:53.233–0:59.233 | Generated trust card | — | 1.00× | Full frame | Agent reasoning → machine-checkable evidence | “The agent does not invent…” |
| 8 | 0:59.233–1:06.233 | Generated Diagram B | — | 1.00× | Five 1.4 s sequential highlights | Collaborative decision loop | “That matters because…” |
| 9 | 1:06.233–1:28.233 | `04-lock-and-replan.mp4` | 0:00.000–0:22.000 | **1.00×** | Full frame; real latency retained | Human constraint → Previous proposal stale → Adaptive replan | “The first mitigation…” |
| 10 | 1:28.233–1:35.233 | Generated performance card | — | 1.00× | Full frame | 4.73 s → 0.51 s / 9.35× | “After profiling…” begins across this transition |
| 11a | 1:35.233–1:44.383 | `05-compare-and-verify.mp4` | 0:00.000–0:09.150 | 1.00× | **390,90,1440×810 → 1920×1080** to enlarge alternatives | Human review / verified bounded alternatives | “InfraTwin compares bounded alternatives…” |
| 11b | 1:44.383–1:51.600 | `05-compare-and-verify.mp4` | 0:09.150–0:16.333 | 1.00× | 18,10,1884×1060 → 1920×1080 | Independent verification | “…selected design is reconstructed…” |
| 12 | 1:51.600–2:00.800 | `06-scale-proof.mp4` | 0:00.000–0:09.200 | 1.00× | Full frame | 500-node browser scale test / 500 · 1,200 · 400 | “This is not limited…” |
| 13 | 2:00.800–2:07.500 | `07-webmcp-proof.mp4` | 0:00.000–0:06.700 | 1.00× | **720,180,1200×675 → 1920×1080** to enlarge diagnostics | Native `document.modelContext` | “The integration uses native…” |
| 14a | 2:07.500–2:17.500 | Generated closing stage 1 | — | 1.00× | Full frame, restrained network motion | Human / Agent / InfraTwin roles | Closing narration begins |
| 14b | 2:17.500–2:25.500 | Generated closing stage 2 | — | 1.00× | Full frame | Humans judge. Agents explore. InfraTwin proves. | Closing narration continues |
| 14c | 2:25.500–2:35.500 | Generated closing stage 3 | — | 1.00× | Full frame | InfraTwin / Plan first. Falsify early. Change safely. | Final line + deliberate pause |

## Claim boundaries preserved

- No claim that an LLM performs routing, optimization, verification, or N-1 computation.
- No claim of autonomous approval or guaranteed safety.
- No implication that the 500-node adaptive optimizer is sub-second.
- No fake ChatGPT UI.
- The 9.35× card refers specifically to candidate-path generation on the supplied flagship workload.
