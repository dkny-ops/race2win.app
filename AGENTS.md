# Instrucciones permanentes del proyecto

Antes de modificar Race To Win o FlappyRace, leer y aplicar
[rules/competition-security.md](rules/competition-security.md).
Estas reglas son requisitos de trabajo; no certifican funciones implementadas
ni el estado de producción. Conservar también las instrucciones más específicas
que existan en el área modificada.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
