# Monaco build-source scope

This directory contains source inputs for generated frontend dependencies. Also
read the repository root `AGENTS.md` and `public/AGENTS.md`.

- Pin dependency versions in `package.json` and `package-lock.json`.
- Import only Monaco capabilities used by the read-only preview.
- Keep workers and editor assets same-origin and locally bundled.
- Do not add remote loaders, source execution, AI assistants, or playground
  integrations.
- After any change here, run `npm run build:frontend` and commit the resulting
  `public/vendor/monaco/**` files with the source change.
