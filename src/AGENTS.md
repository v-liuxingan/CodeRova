# Backend agent scope

This directory is owned by the Rust backend role. Also read the repository root
`AGENTS.md`.

Preserve these boundaries:

- HTTP requests identify a graph, target type, and target ID; they do not carry
  arbitrary source paths.
- Resolve every source location through `ProjectCatalog` and verify it remains
  inside the configured project root.
- Source preview is bounded, UTF-8-only, read-only, and does not execute a
  language analyzer, shell, editor, or child process.
- External navigation returns a validated URI; the server does not launch it.
- Storage, preview, navigation, and project catalog behavior stay behind their
  existing traits so implementations remain replaceable.
- Serialized API fields use `camelCase`.

Backend changes must pass formatting, unit tests, Clippy with warnings denied,
and affected callgraph validation. Contract changes additionally require the
root contract-change protocol and browser E2E.
