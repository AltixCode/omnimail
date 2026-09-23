# OmniMail Agent Manifest

See [HANDOFF.md](file:///Users/ata/Dev/omnimail/HANDOFF.md) for architecture, credentials, and deployment procedures.

## Quick Commands
- `pnpm dev`: Start local Next.js development server
- `pnpm typecheck`: Run TypeScript typecheck
- `pnpm build`: Run Next.js standalone production build
- `pnpm db:seed`: Seed sample multi-account data and calendar events
- `pnpm test:verify`: Run end-to-end autonomous verification suite
- `pnpm prisma db push`: Synchronize schema with PostgreSQL

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
