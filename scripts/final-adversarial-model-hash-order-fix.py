from pathlib import Path

# Temporary patcher for F-014. Remove before final freeze.
p = Path('packages/model/src/index.ts')
s = p.read_text()
old = """export function semanticProjectValue(project: NetworkProject): NetworkProject {\n  const semantic = cloneProject(project);\n  semantic.nodes = semantic.nodes.map(({ x: _x, y: _y, ...node }) => node);\n  if (semantic.metadata) semantic.metadata = stripPresentationMetadata(semantic.metadata) as Record<string, unknown>;\n  return semantic;\n}\n"""
new = """export function semanticProjectValue(project: NetworkProject): NetworkProject {\n  const semantic = cloneProject(project);\n  const compareId = <T extends { id: string }>(left: T, right: T) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0;\n  // These canonical collections are validated to have unique IDs, so insertion order is document presentation/history, not engineering semantics.\n  semantic.nodes = semantic.nodes.map(({ x: _x, y: _y, ...node }) => node).sort(compareId);\n  semantic.links = semantic.links.sort(compareId);\n  semantic.demands = semantic.demands.sort(compareId);\n  semantic.serviceClasses = semantic.serviceClasses.sort(compareId);\n  if (semantic.metadata) semantic.metadata = stripPresentationMetadata(semantic.metadata) as Record<string, unknown>;\n  return semantic;\n}\n"""
if old not in s:
    raise SystemExit('semanticProjectValue anchor not found')
s = s.replace(old, new, 1)
p.write_text(s)
