# Integrations — attaching the cloud link & payment gateway later

The product is designed so the **cloud backend** and the **payment gateway** are plug-in
concerns. You can build, run, and demo the whole local flow (preview generation → manifest →
collect) with **no** cloud or payment configured, then attach them later by setting environment
variables — **no code changes required**.

Everything is read from environment variables (`.env`, see `.env.example`). Nothing is
hard-coded.

---

## 1. Cloud link (Supabase + Cloudflare R2)

When your Supabase project and R2 bucket are ready, fill these in `.env`:

```
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...      # server / edge functions only
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=photobooth-previews
R2_PUBLIC_BASE_URL=https://previews.yourcdn.com
# gallery (Vite) needs the VITE_-prefixed copies:
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_R2_PUBLIC_BASE_URL=...
```

Where it plugs in (already wired to read these vars):
- Gallery client: `apps/gallery/src/lib/supabase.ts`
- Edge functions: `supabase/functions/*` read `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
- Apply the DB schema: `supabase db reset` (runs `supabase/migrations/*`)

Until these are set, the desktop app still runs the **local** preview/collect flow; only the
upload + gallery steps are inert.

---

## 2. Payment gateway (Stripe — or swap your own)

Billing is **optional and feature-flagged**. With no payment keys set, every studio operates on
the **free plan** and the app is fully usable. Attach payments later by:

1. Setting the keys in `.env`:
   ```
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   BILLING_ENABLED=true
   ```
2. Implementing the two TODO edge functions (checkout session + webhook) under
   `supabase/functions/` — they update the existing `subscriptions` table, which already exists
   in the schema.

### The pluggable seam

Plan limits are enforced through one pure module — `packages/core/src/entitlements.ts` — not
scattered through the app. It maps a plan → limits and answers "can this studio create another
project / upload another N photos?". It does **not** know about Stripe. The billing provider's
only job is to keep the `subscriptions` row's `plan` accurate; everything downstream reads the
plan and asks `entitlements.ts`.

```
Stripe (or any gateway)  ──webhook──▶  subscriptions.plan  ──▶  entitlements.ts  ──▶  app checks
        ^ swappable                       ^ source of truth        ^ provider-agnostic
```

This means you can replace Stripe with Razorpay, Paddle, or a manual admin toggle without
touching product logic — just keep `subscriptions.plan` updated.
