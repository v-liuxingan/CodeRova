# Frontend agent scope

This directory is owned by the browser frontend role. Also read the repository
root `AGENTS.md`.

Preserve these boundaries:

- Use `CodeRovaApi` for server communication; UI controllers do not call
  filesystem or editor processes.
- Keep graph state, layout, renderer, theme, navigation policy, inspector
  workbench, and source-code surface implementations replaceable.
- Buttons and keyboard shortcuts for the same action must call the same
  controller or state-machine entry point.
- Graph clicks select by default. Instant external navigation remains an
  explicit opt-in user preference.
- Render untrusted graph and source text with DOM text APIs. Do not introduce
  `innerHTML` for source content.
- Keep the main document CSP strict. Monaco runs only in its isolated preview
  document and must retain the safe DOM fallback.
- Do not hand-edit `vendor/monaco/**`; rebuild it from `frontend/` with the npm
  script.

Frontend changes must pass JavaScript syntax checks and Playwright E2E. Changes
to API payloads require the root contract-change protocol.
