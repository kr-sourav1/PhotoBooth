# Setup — attach the cloud (Supabase + Cloudflare R2)

This makes Phase 2 (and the gallery) live. ~20 minutes. Originals still never leave the studio
machine — only previews are uploaded.

## 1. Supabase project

1. Create a project at https://supabase.com → note the **Project URL**, **anon key**, and
   **service_role key** (Settings → API).
2. Apply the schema. Either:
   - **CLI:** `supabase link --project-ref <ref>` then `supabase db push` (applies
     `supabase/migrations/*`), or
   - **Dashboard:** paste `0001_init.sql` then `0002_signup_bootstrap.sql` into the SQL editor.
3. Auth → Providers → **Email**: enable. For quick testing, turn **off** "Confirm email".
4. Create a studio user: Auth → Users → **Add user** with an email/password. The
   `handle_new_user` trigger auto-creates that user's studio, owner row, and subscription.

## 2. Cloudflare R2 bucket

1. R2 → **Create bucket** (e.g. `photobooth-previews`). Note your **Account ID**.
2. R2 → **Manage API Tokens** → create a token with **Object Read & Write** → note the
   **Access Key ID** and **Secret Access Key**.
3. Public preview reads (for the gallery): enable the bucket's **public r2.dev URL** or attach a
   **custom domain** behind Cloudflare CDN. That URL is `VITE_R2_PUBLIC_BASE_URL`.
   - No CORS config is needed for *uploads* — they're presigned PUTs sent natively from the Rust
     side, not the browser. CORS only matters if you later upload from a web page.

## 3. Edge function secrets + deploy

```bash
supabase secrets set \
  R2_ACCOUNT_ID=... R2_BUCKET=photobooth-previews \
  R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=...

supabase functions deploy r2-sign-upload
supabase functions deploy gallery-get
supabase functions deploy selection-submit
```
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)

## 4. App env files

Each Vite app reads its own `.env`. Copy the root template and fill the `VITE_` values:

```bash
# apps/desktop/.env
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_R2_PUBLIC_BASE_URL=https://<your-r2-public-or-cdn-domain>

# apps/gallery/.env   (same three values)
```

## 5. Verify the round trip

1. `pnpm --filter @photobooth/desktop tauri dev`
2. Sign in with the studio user from step 1.4.
3. Enter a project name → choose a folder of photos → **Generate & upload previews**.
4. Confirm in Supabase: a `projects` row (`status = awaiting_selection`) and `photos` rows; in
   R2: objects under `<studio_id>/<project_id>/<uuid>.jpg`. **Originals untouched on disk.**
5. (Phase 3) open the gallery against that project's share link to browse the previews.

## Security notes
- R2 credentials live only in Supabase function secrets; the desktop app receives just
  time-limited presigned URLs (15-min TTL).
- `r2-sign-upload` rejects any object key not under the caller's `<studio_id>/` prefix, so a
  studio can never upload into another studio's namespace (storage-layer tenant isolation).
