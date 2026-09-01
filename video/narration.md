# InfraTwin final demo narration

**Target runtime:** 2:35.5  
**Script length:** 326 words  
**Delivery target:** measured technical delivery, approximately 125–135 WPM with deliberate pauses around the diagrams and final synthesis.

> **Audio status:** no recorded narration was supplied. Per the editing brief, this implementation does not synthesize or imitate a voice without explicit authorization. `InfraTwin-final-demo.mp4` therefore carries a silent AAC timing track; use `scripts/mux-narration.sh` with a real `narration.wav` or `narration.mp3` before submission.

## Script

Network changes rarely fail in isolation. A maintenance outage, new traffic, or a capacity constraint can create failures somewhere completely unexpected.

InfraTwin lets an engineer model those changes before they reach production.

The key is WebMCP. Instead of sending an agent a stale API copy, InfraTwin lets the engineer and agent operate on the same live, unsaved Network and ChangePlan in the browser.

The engineer takes a Northeast-to-Central backbone link offline. The agent reads that exact selection through WebMCP and adds the expected twenty-percent Payments growth to the same plan.

InfraTwin then runs deterministic routing and capacity analysis. The combined change overloads a different Southeast-to-Central corridor, with the failure and utilization evidence linked back to the workspace.

The agent does not invent that conclusion. The evidence comes from machine-checkable computation.

That matters because real engineering includes constraints an optimizer only learns when the human supplies them.

The first mitigation is the cheapest capacity upgrade. But the engineer knows that corridor cannot be modified, so they lock it in the workspace. The old proposal becomes stale immediately. The agent observes the new restriction and asks InfraTwin for another bounded design, allowing routing and capacity changes around the protected resource.

After profiling the design engine, candidate-path generation on the flagship workload fell from 4.73 seconds to 0.51—roughly 9.35 times faster, without changing the mathematical result.

InfraTwin compares bounded alternatives by cost, peak utilization, and verification status. The engineer remains in control of the choice, and the selected design is reconstructed and independently verified before approval.

This is not limited to a tiny demo topology. The browser workspace has also been validated on a five-hundred-node, twelve-hundred-link, four-hundred-demand network.

The integration uses native document.modelContext capability registration and execution in the browser, not a parallel backend state.

Humans provide intent, operational knowledge, and approval. Agents explore and revise alternatives. InfraTwin supplies the deterministic evidence connecting the two, so teams can falsify bad changes before production instead of discovering them afterward.
