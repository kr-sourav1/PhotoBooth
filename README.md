# PhotoBooth

**Preview-based photo selection platform for photography studios.** Studios shoot thousands
of high-res images per event (8 GB+). Instead of uploading all originals to the cloud,
PhotoBooth uploads only lightweight **previews** (~200 KB). Clients browse and select on the
web; a studio-side **desktop app** then collects the matching originals locally — the
high-res files never leave the studio's machine.

> Built as a multi-tenant **B2B SaaS**: studios sign up, get isolated accounts, and are
> billed by subscription.

## Architecture

| Component | Stack | Role |
|-----------|-------|------|
| `apps/desktop` | Tauri 2 + React + Rust | Generate previews locally, upload previews, auto-collect selected originals |
| `apps/gallery` | Vite + React PWA | Client-facing gallery; browse previews, select, submit (no login) |
| `supabase/` | Postgres + Auth + RLS + Edge Functions | Multi-tenant data, auth, server logic |
| Cloudflare R2 | S3-compatible object storage + CDN | Preview storage with zero egress fees |
| Stripe | — | B2B subscription billing |
| `packages/core` | TypeScript | Shared selection-matching logic (UUID-first) |
| `packages/types` | TypeScript | Shared domain + Supabase-generated types |

See [the full plan](.claude-plan.md) for the phased roadmap. Originals stay 100% local;
photos are matched back by **stable UUID** (filename fallback) so duplicate filenames across
cameras don't collide.

## Monorepo layout

```
apps/        desktop (Tauri), gallery (web PWA)
packages/    core (matching logic), types (shared types)
supabase/    migrations (schema + RLS), functions (edge functions)
```

## Prerequisites

- Node.js >= 20, pnpm 9 (`corepack enable`)
- Rust toolchain + Tauri prerequisites (for `apps/desktop` — see Tauri docs)
- Supabase CLI (for local DB + migrations)

## Getting started

```bash
corepack enable
pnpm install
cp .env.example .env        # fill in Supabase / R2 / Stripe values

# Run the test suite (core matching logic)
pnpm test

# Local database
supabase start
supabase db reset           # applies migrations in supabase/migrations
pnpm db:types               # regenerate packages/types/src/database.ts

# Gallery web app
pnpm --filter @photobooth/gallery dev

# Desktop app (requires Rust toolchain)
pnpm --filter @photobooth/desktop tauri dev
```

## Status

Phase 0 (foundation) scaffolded. See the roadmap for Phases 1–6.
