# Running PhotoBooth fully locally (no cloud account)

A complete local stack: Supabase (Postgres + Auth + Storage + Edge Functions) in Docker, the
client gallery, and the studio desktop app — all on your machine. Previews go to **Supabase
Storage** locally (production uses Cloudflare R2; switch via `VITE_STORAGE_BACKEND`).

## Prerequisites
- Docker Desktop running
- Supabase CLI (`brew install supabase/tap/supabase`)
- Node 20+ and pnpm (`pnpm install` once at the repo root)
- Rust toolchain (for the desktop app)

## 1. Start the backend
```bash
supabase start              # boots the stack and applies supabase/migrations/*
supabase functions serve --no-verify-jwt   # serves gallery-get / selection-submit (keep running)
```
`supabase status` prints the local URLs and keys:
- API: http://127.0.0.1:54321 · Studio UI: http://127.0.0.1:54323
- Use the printed `ANON_KEY` (JWT form) as `VITE_SUPABASE_ANON_KEY`.

## 2. Create the previews bucket + a studio user (first run only)
```bash
# storage bucket + policies
psql 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' <<'SQL'
insert into storage.buckets (id,name,public) values ('previews','previews',true)
  on conflict (id) do update set public=true;
create policy previews_auth_write on storage.objects for insert to authenticated with check (bucket_id='previews');
create policy previews_read       on storage.objects for select using (bucket_id='previews');
SQL

# a studio user (fires the signup trigger → creates a studio)
SVC=<SERVICE_ROLE_KEY from `supabase status`>
curl -s -X POST 'http://127.0.0.1:54321/auth/v1/admin/users' \
  -H "apikey: $SVC" -H "Authorization: Bearer $SVC" -H 'Content-Type: application/json' \
  -d '{"email":"studio@demo.com","password":"password123","email_confirm":true,"user_metadata":{"studio_name":"Demo Studio"}}'
```

## 3. App env files
`apps/gallery/.env` and `apps/desktop/.env` (gitignored) — fill from `supabase status`:
```
# both apps
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<ANON_KEY>
# gallery only — where previews are read from
VITE_R2_PUBLIC_BASE_URL=http://127.0.0.1:54321/storage/v1/object/public/previews
# desktop only
VITE_STORAGE_BACKEND=supabase
VITE_GALLERY_BASE_URL=http://localhost:5174    # the gallery's actual port (see note)
```

## 4. Run the apps
```bash
pnpm --filter @photobooth/gallery dev     # client gallery (http://localhost:5173, or 5174 if 5173 is taken)
pnpm --filter @photobooth/desktop tauri dev  # studio desktop app
```

## 5. Try the full loop
1. Desktop app → sign in `studio@demo.com` / `password123`.
2. Enter a project name → choose a folder of photos → **Generate & upload previews**.
3. Copy the client gallery link it shows → open it in a browser → select photos → **Submit**.
4. Back in the desktop app → **Collect selections** tab → choose the same originals folder →
   **Collect** → the chosen originals are copied into `<folder>/Selected Photos/`.

## Optional: seed sample data without the desktop app
`apps/gallery/seed-demo.mjs` creates a demo project with sample previews (share token `demo`):
```bash
SUPABASE_URL=http://127.0.0.1:54321 SERVICE_ROLE_KEY=<svc> STUDIO_ID=<studio uuid> \
  node apps/gallery/seed-demo.mjs
# then open http://localhost:5174/g/demo
```

## Notes
- **Port:** if another app holds 5173, Vite uses 5174 — set `VITE_GALLERY_BASE_URL` to match.
- **Reset everything:** `supabase stop` (keeps data) / `supabase db reset` (re-applies migrations,
  wipes data). The grants in `0003_grants.sql` and storage bucket/policies must be re-applied
  after a full reset.
- **Stop:** `supabase stop`; Ctrl-C the `functions serve`, gallery, and desktop processes.
