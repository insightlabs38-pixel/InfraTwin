from pathlib import Path

path = Path('packages/optimizer/src/level4-design.ts')
text = path.read_text()
old = "export function filterParetoVariants(points:AdaptiveDesignVariant[]){return points.filter((p,i)=>!points.some((o,j)=>i!==j&&dominatesDesign(o,p))).sort((a,b)=>a.totalCost-b.totalCost||a.peakUtilizationPct-b.peakUtilizationPct||a.id.localeCompare(b.id))}"
new = """export function filterParetoVariants(points:AdaptiveDesignVariant[]){
  const nondominated=points
    .filter((p,i)=>!points.some((o,j)=>i!==j&&dominatesDesign(o,p)))
    .sort((a,b)=>a.totalCost-b.totalCost||a.peakUtilizationPct-b.peakUtilizationPct||b.scenarioPassCount-a.scenarioPassCount||a.id.localeCompare(b.id));
  const seenObjectives=new Set<string>();
  return nondominated.filter((point)=>{
    const objectiveKey=JSON.stringify([point.totalCost,point.peakUtilizationPct,point.scenarioPassCount,point.scenarioCount]);
    if(seenObjectives.has(objectiveKey))return false;
    seenObjectives.add(objectiveKey);
    return true;
  });
}"""
if old not in text:
    raise SystemExit('Expected filterParetoVariants implementation not found; refusing broad rewrite')
path.write_text(text.replace(old, new, 1))
