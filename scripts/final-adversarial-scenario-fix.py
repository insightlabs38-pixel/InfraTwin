from pathlib import Path

path = Path('packages/optimizer/src/level4-design.ts')
text = path.read_text()
old1 = "selected=[...(input.scenarioPatches??[])];let last:AdaptiveDesignResult|null=null;try{for(let iteration=1;iteration<=maxIterations;iteration++){checkAbort(options.signal);last=await optimizeAdaptiveDesign(project,{...input,scenarioPatches:selected},options);if(!last.variant)"
new1 = "selected=[...(input.scenarioPatches??[])];let last:AdaptiveDesignResult|null=null,completedIterations=0;try{for(let iteration=1;iteration<=maxIterations;iteration++){checkAbort(options.signal);last=await optimizeAdaptiveDesign(project,{...input,scenarioPatches:selected},options);completedIterations=iteration;if(!last.variant)"
old2 = "if(error instanceof Error&&error.name==='AbortError')return{result:last,termination:'CANCELLED',iterations:0,selectedScenarioHashes:selected.map(scenarioHash)};throw error}}"
new2 = "if(error instanceof Error&&error.name==='AbortError')return{result:last,termination:'CANCELLED',iterations:completedIterations,selectedScenarioHashes:selected.map(scenarioHash)};throw error}}"
if text.count(old1) != 1 or text.count(old2) != 1:
    raise SystemExit(f'Expected scenario-generation anchors not unique: first={text.count(old1)} second={text.count(old2)}')
text = text.replace(old1, new1, 1).replace(old2, new2, 1)
path.write_text(text)
