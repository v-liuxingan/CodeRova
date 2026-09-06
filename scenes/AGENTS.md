# Independent scene data

Before creating or editing Mermaid scenes or scene JSON, read `../docs/scenario-authoring.md`.
Prefer Mermaid sequence text with matching JSON metadata; complete JSON remains supported.
Use only the documented syntax subset; unsupported statements must not be silently omitted.
Generate execution semantics only; do not write coordinates, SVG, CSS, or callgraph target mappings.
The shared renderer owns presentation. Preserve source-backed conditions, loops, parallel
regions and evidence. Do not impose fixed content count limits.
Run `npm run build:scenes` and `npm run check:scenes`, and include generated pages with the data.
This directory is distinct from legacy `scenarios/` used by the Atlas experiment.
