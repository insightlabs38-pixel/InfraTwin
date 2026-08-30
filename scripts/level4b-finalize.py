from pathlib import Path

# Add explicit adaptive-design phase reporting inside the optimizer without changing formulation semantics.
path = Path('packages/optimizer/src/level4-design.ts')
text = path.read_text()
text = text.replace(
    "candidatePathSet?:CandidatePathSet}={}):Promise<AdaptiveDesignResult>",
    "candidatePathSet?:CandidatePathSet;onProgress?:(phase:string)=>void}={}):Promise<AdaptiveDesignResult>",
    1,
)
text = text.replace(
    "}const started=now(),ps=now(),pathSet=options.candidatePathSet??generateCandidatePaths(project,input,{signal:options.signal}),pathMs=options.candidatePathSet?0:now()-ps;",
    "}if(!options.candidatePathSet)options.onProgress?.('Preparing route alternatives');const started=now(),ps=now(),pathSet=options.candidatePathSet??generateCandidatePaths(project,input,{signal:options.signal}),pathMs=options.candidatePathSet?0:now()-ps;",
    1,
)
text = text.replace(
    ";const ms=now(),built=buildDesignMILP(project,r,pathSet),modelConstructionMs=now()-ms;checkAbort(options.signal);const ws=now(),highs=await loadHighs(options),wasmInitializationMs=now()-ws;",
    ";options.onProgress?.('Building optimization model');const ms=now(),built=buildDesignMILP(project,r,pathSet),modelConstructionMs=now()-ms;checkAbort(options.signal);options.onProgress?.('Solving design');const ws=now(),highs=await loadHighs(options),wasmInitializationMs=now()-ws;",
    1,
)
text = text.replace(
    "};const verification=verifyAdaptiveDesign(project,provisional,input),peak=verification.calculatedPeakUtilizationPct??0",
    "};options.onProgress?.('Verifying proposal');const verification=verifyAdaptiveDesign(project,provisional,input),peak=verification.calculatedPeakUtilizationPct??0",
    1,
)
text = text.replace(
    "options:SolverRunOptions&{signal?:AbortSignal;sourcePlanHash?:string|null;targets?:number[]}={}):Promise<AdaptiveDesignVariant[]>{",
    "options:SolverRunOptions&{signal?:AbortSignal;sourcePlanHash?:string|null;targets?:number[];onProgress?:(phase:string)=>void}={}):Promise<AdaptiveDesignVariant[]>{",
    1,
)
text = text.replace(
    "  checkAbort(options.signal);const candidatePathSet=generateCandidatePaths(project,input,{signal:options.signal});",
    "  checkAbort(options.signal);options.onProgress?.('Preparing route alternatives');const candidatePathSet=generateCandidatePaths(project,input,{signal:options.signal});",
    1,
)
path.write_text(text)

# Wire browser worker phase messages into the existing optimizer status UI.
path = Path('apps/web/components/workbench-m35d-stage3.tsx')
text = path.read_text()
text = text.replace(
    "optimizeAdaptiveDesignInBrowser(base, requirements, 10_000, signal, sourcePlanHash)",
    "optimizeAdaptiveDesignInBrowser(base, requirements, 10_000, signal, sourcePlanHash, setOptimizerMessage)",
    1,
)
text = text.replace(
    "optimizeDesignParetoInBrowser(base, requirements, 10_000, signal, sourcePlanHash)",
    "optimizeDesignParetoInBrowser(base, requirements, 10_000, signal, sourcePlanHash, setOptimizerMessage)",
    1,
)
path.write_text(text)

# Fix the progress message payload: the field must contain the phase string, not the callback itself.
path = Path('apps/web/workers/optimizer.worker.ts')
text = path.read_text()
text = text.replace(
    "const progress=(phase:string)=>self.postMessage({taskId:request.taskId,kind:'progress',progress} satisfies Response);",
    "const sendProgress=(phase:string):void=>{self.postMessage({taskId:request.taskId,kind:'progress',progress:phase} satisfies Response);};",
    1,
)
text = text.replace("onProgress:progress", "onProgress:sendProgress")
path.write_text(text)

# Add focused tests for Pareto reuse and phase reporting.
path = Path('tests/level4b-path-engine.test.ts')
text = path.read_text()
text = text.replace(
    "  generateCandidatePathsReference,\n",
    "  generateCandidatePathsReference,\n  optimizeAdaptiveDesign,\n  optimizeDesignPareto,\n",
    1,
)
append = r'''

test('Level 4B Pareto variants reuse the exact same candidate path set', async () => {
  resetLevel4PathCaches();
  const project = createLevel4ReplanReference();
  const variants = await optimizeDesignPareto(project, { maxCandidatePaths:5, targetUtilizationPct:80 }, { targets:[80,70,60] });
  assert.ok(variants.length > 0);
  const first = variants[0].candidatePathSet;
  for (const variant of variants) {
    assert.equal(variant.candidatePathSet, first);
    assert.equal(variant.candidatePathSet.hash, first.hash);
  }
  assert.equal(first.generationDiagnostics?.cacheMisses, project.demands.length);
});

test('Level 4B adaptive optimizer reports user-facing preparation, model, solve, and verification phases', async () => {
  resetLevel4PathCaches();
  const project = createLevel4ReplanReference();
  const phases:string[] = [];
  const result = await optimizeAdaptiveDesign(project, { maxCandidatePaths:5, targetUtilizationPct:80 }, { onProgress: phase => phases.push(phase) });
  assert.ok(result.variant);
  assert.deepEqual(phases, ['Preparing route alternatives','Building optimization model','Solving design','Verifying proposal']);
});
'''
if "Pareto variants reuse the exact same candidate path set" not in text:
    text = text.rstrip() + append + "\n"
path.write_text(text)
