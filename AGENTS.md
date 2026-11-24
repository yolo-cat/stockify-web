# AGENTS.md — `stockify-web` Repository Guidelines

This project is the web port of **韭菜記帳本 (Stockify)** targeting React + Vite + TypeScript + Tailwind CSS + shadcn/ui + Vitest + Lovable Cloud (Supabase PostgreSQL, RLS, Google OAuth, Deno Edge Functions).

## 1. Commands

- Install dependencies: `npm ci` (never mutate `package.json` or lockfiles inside `/swarm` workers without `@coordinator`).
- Typecheck: `npm run typecheck` (runs `tsc --noEmit`).
- Unit tests: `npm test` (runs `vitest run`).
- Production build: `npm run build` (runs `vite build`).
- Package Lovable ZIP: `npm run zip:lovable` (runs `node scripts/package-lovable-zip.mjs`, outputs `dist/stockify-web-lovable.zip`).

## 2. Reference Specs & Test Vectors

- `docs/android-to-web-spec.md`: Complete Android-to-Web behavioral parity specification.
- `docs/golden-test-vectors.json`: 78 structured golden test vectors across all 7 module groups.
- `Stockify/` (Android reference repository): **Strictly read-only**. Never write, modify, or run mutating commands against `Stockify/`.

## 3. Vertical Slice Ownership (`/swarm`)

- `calc-engine` (`workspace:"share"`): `src/domain/**` — pure TypeScript portfolio replay, margin/short selling, XIRR, history chart & performance calendar calculations, validation, CSV/JSON codecs, and Vitest unit tests.
- `backend-sync` (`workspace:"share"`): `supabase/functions/**`, `src/services/**`, `src/hooks/useAuth.ts`, `src/hooks/usePortfolioData.ts` — Edge Functions and Supabase client/CRUD/sync services.
- `ui-portfolio` (`workspace:"share"`): `src/components/layout/**`, `src/features/holdings/**`, `src/features/charts/**`, `src/features/stock-detail/**`.
- `ui-ledger` (`workspace:"share"`): `src/features/transactions/**`, `src/features/assets/**`, `src/features/dividends/**`, `src/features/settings/**`.
- `verifier` (`workspace:"inherit"`): Read-only code/RLS/DRY audit, sequential `npm run typecheck && npm test && npm run build && npm run zip:lovable`, and UI verification.

## 4. Protected, Frozen & No-Touch Zones

- **Frozen / Protected** (coordinate with `@coordinator` before editing):
  - `src/types/*` (`domain.ts`, `market.ts`, `api.ts`, `index.ts`)
  - `src/integrations/supabase/*` (`client.ts`, `types.ts`)
  - `supabase/migrations/*`, `supabase/config.toml`
  - `package.json`, `package-lock.json`, `vite.config.ts`, `src/App.tsx`
- **No-Touch**:
  - `Stockify/` (Android reference repo)
  - `.env` / `.env.*` (except `.env.example`)
  - `.agents/plugins/swarm-guardrails/` (keep intact and enabled)

## 5. Lovable Cloud & Supabase Invariants

- All user-owned tables (`accounts`, `transactions`, `bank_deposits`, `loans`, `user_settings`, `holdings_order`) enforce `user_id` + RLS (`auth.uid() = user_id`).
- Shared tables (`stocks`, `stock_history_prices`) allow `SELECT` for `authenticated` users only; writes go through Edge Functions with Service Role credentials.
- Frontend Supabase client (`src/integrations/supabase/client.ts`) reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY ?? VITE_SUPABASE_ANON_KEY`, with a safe fallback warning when unconfigured in local preview.
- All external market/FX/holiday/dividend/stock-list fetches run via `supabase/functions/*` (never direct browser fetches to CORS-restricted TWSE/TPEx/Yahoo/Nasdaq endpoints).
- `npm run zip:lovable` must exclude `node_modules/`, `dist/`, `.env*`, `.git/`, `.agents/` and stay under **250 MB**.

## 6. Git Hygiene

- Never run `git push`.
- Keep working trees clean before reporting completion.
