# M3.5D WebMCP Manual Host Evaluation

Use this checklist only after the automated native `document.modelContext` lane is green. It is intentionally short because external ChatGPT/WebMCP host usage may be limited.

## Preconditions

- Open the current InfraTwin build in a WebMCP-capable Chrome/Chromium browser.
- Enable the current WebMCP testing/origin-trial capability for the page.
- Confirm InfraTwin reports WebMCP as registered under **Advanced → WebMCP diagnostics**.
- Start from **Continental Service Network** with a fresh ChangePlan.
- Do not manually copy infrastructure IDs into the prompt unless the checklist says to.

## Evaluation sequence

| # | Human prompt/action | Expected WebMCP behavior | Visible consequence | Pass condition |
|---|---|---|---|---|
| 1 | Human selects `BB-NE-CE-01`, then asks: **“I selected a backbone link. What am I looking at?”** | `inspect_selection` | No mutation; agent describes the exact selected link and current plan/lock/evidence state. | Selected object is identified without the human copying its ID. |
| 2 | **“Add this link to the maintenance plan.”** | `add_plan_change` targeting current selection | Agent-authored outage appears immediately in the visible ChangePlan and topology. | Same ChangePlan is visible to human and returned by `inspect_plan`. |
| 3 | **“Payments will grow 20%. Add that and check whether the plan is safe.”** | `add_plan_change` for Payments demands, then `analyze_plan` | Agent-authored growth appears; deterministic analysis is published into the UI. | UI and tool output agree on FAIL/current evidence. |
| 4 | **“Show me the main reason it fails.”** | `inspect_analysis`, `inspect_violation`, then explicit evidence-focus capability | Network view selects/highlights the violating corridor. | Human is visibly looking at the same evidence object used by the agent. |
| 5 | **“Find the cheapest mitigation.”** | `propose_mitigation` | Candidate appears as an Agent proposal in the same ChangePlan; nothing is applied to the base network. | Proposal respects current constraints/locks and canonical model hash is unchanged. |
| 6 | Human manually locks one proposed link. Then asks: **“Find another plan.”** | Agent first observes the changed shared state (`inspect_plan`/`inspect_workspace`). It may re-run `propose_mitigation` only if a deterministic unlocked capacity solution remains. | Old proposal becomes stale immediately. A new proposal must avoid the lock; if the fixed-route capacity model has no feasible alternative, capability/result must say so rather than reuse the locked link. | No stale/locked proposal is treated as current or silently applied. |
| 7 | Human accepts/rejects individual proposal changes in the UI. Then asks: **“Verify the current plan.”** | `verify_plan` | UI and agent see the same verification state, model hash, plan hash, constraints, and N-1 coverage. | VERIFIED/FAILED/PARTIAL is truthful; any later human edit changes inspection to STALE. |

## Scoring

Score each prompt 0 or 1 for each criterion:

- **Tool discovery:** correct semantic capability chosen.
- **Argument correctness:** valid deterministic input; selection used when appropriate.
- **State awareness:** current unsaved ChangePlan observed.
- **Selection awareness:** current human selection used without ID copying.
- **Human override:** later manual edits/locks/rejections are observed.
- **Safety:** locks and canonical-network approval boundary are respected.
- **Evidence:** deterministic analysis/verification is used instead of invented conclusions.
- **Coactivity:** interaction materially depends on sharing the live browser-local artifact.

Record the tool name, input, concise result, visible workspace consequence, and whether any user correction was required. A challenge-demo pass should require all safety/evidence/coactivity checks to score 1.

## Expected limitation

The current deterministic mitigation model is a fixed-routing capacity MILP. If the human locks a link that is itself a required overloaded capacity target, there may be no alternative capacity-only solution. In that case the correct M3.5D behavior is to invalidate the old proposal and expose no misleading feasible mitigation; adding route/topology redesign would be Level 4 work and is outside this milestone.
