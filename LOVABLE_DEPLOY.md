# Stockify Web (`韭菜記帳本`) — Lovable Deployment Guide

This repository is structured for direct import into **Lovable** using **Lovable Cloud (Supabase PostgreSQL + RLS + Google OAuth + Edge Functions)**.

---

## 1. Build & Package the Lovable ZIP

From the repository root:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run zip:lovable
```

This creates `dist/stockify-web-lovable.zip`, excluding `node_modules/`, `dist/`, `.env*`, `.git/`, and `.agents/`, and verifies:
- Required project roots (`package.json`, `vite.config.ts`, `index.html`, `src/App.tsx`, `supabase/config.toml`, `supabase/migrations/0001_initial_schema.sql`) are present.
- Archive size is strictly under **250 MB**.

---

## 2. Import into Lovable

1. Open Lovable and click **`+` → `Import project` → `Upload code`**.
2. Upload `dist/stockify-web-lovable.zip`.
3. Confirm Lovable detects Vite + React + TypeScript (`npm run build`).

---

## 3. Enable Lovable Cloud (Supabase) & Environment Variables

1. In the Lovable project, open **Cloud / Supabase** and enable **Lovable Cloud**.
2. Lovable Cloud automatically provisions your Supabase project and injects:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` (or `VITE_SUPABASE_ANON_KEY`)
3. For local development outside Lovable, copy `.env.example` to `.env.local` and fill in your project's URL and anon/publishable key. Never commit `.env*` secret files.

---

## 4. Apply Initial Database Schema (`0001_initial_schema.sql`)

Apply `supabase/migrations/0001_initial_schema.sql` via Lovable Cloud SQL Editor or Supabase CLI (`supabase db push`):

- User-owned tables (`auth.uid() = user_id` RLS for `SELECT`, `INSERT`, `UPDATE`, `DELETE` to `authenticated`):
  - `accounts`
  - `transactions`
  - `bank_deposits`
  - `loans`
  - `user_settings`
  - `holdings_order`
- Shared reference/cache tables (`SELECT` to `authenticated`; writes via Service Role in Edge Functions):
  - `stocks`
  - `stock_history_prices`

Verify in the Supabase Dashboard that **Row Level Security (RLS)** is enabled on all 8 tables and no anonymous write policies exist.

---

## 5. Deploy Edge Functions

External market/FX/holiday/dividend/stock-list endpoints run inside `supabase/functions/*` (Deno runtime) to prevent browser CORS blocks:

- `market-quotes`
- `market-history`
- `market-index`
- `exchange-rate`
- `taiwan-calendar`
- `stock-list-sync`
- `dividend-info`

Deploy all Edge Functions via Lovable Cloud or Supabase CLI:

```bash
supabase functions deploy market-quotes market-history market-index exchange-rate taiwan-calendar stock-list-sync dividend-info
```

Seed the `stocks` catalog from `public/data/stocks.json` and `public/data/us_stocks.json` or trigger `stock-list-sync`.

---

## 6. Configure Google OAuth (Published URL)

1. Publish the app in Lovable to obtain your **Published URL** (e.g. `https://<your-app>.lovable.app` or your custom domain).
2. In **Google Cloud Console → APIs & Services → Credentials**:
   - Create an **OAuth 2.0 Client ID** (Web application).
   - Add Authorized JavaScript origins:
     - `https://<your-app>.lovable.app`
     - `http://localhost:8080` (for local testing)
   - Add Authorized redirect URI:
     - `https://<your-supabase-project-ref>.supabase.co/auth/v1/callback`
3. In **Lovable Cloud → Authentication → Providers → Google**:
   - Enable Google provider and enter the Google **Client ID** and **Client Secret**.
4. In **Lovable Cloud → Authentication → URL Configuration**:
   - Set **Site URL** to your **Published URL** (e.g. `https://<your-app>.lovable.app`).
   - Add **Redirect URLs**:
     - `https://<your-app>.lovable.app/**`
     - `http://localhost:8080/**` (if developing locally)

---

## 7. Post-Deploy Verification Checklist

- [ ] Visiting the Published URL redirects unauthenticated users to `/login`.
- [ ] Clicking **"使用 Google 帳號登入"** completes Google OAuth and lands on `/holdings`.
- [ ] Authenticated queries to `accounts`, `transactions`, `bank_deposits`, `loans`, `user_settings`, and `holdings_order` only return the signed-in user's rows.
- [ ] Shared `stocks` and `stock_history_prices` tables are readable when signed in and reject client-side writes.
- [ ] Reloading `/holdings`, `/transactions`, `/assets`, `/dividends`, `/settings`, and `/stocks/TW/2330` preserves session and route state.
