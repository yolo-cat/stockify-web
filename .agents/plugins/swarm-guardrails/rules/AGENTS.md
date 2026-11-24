# Swarm Worker Boundaries & Project Conventions (`stockify-web`)

## Commands

- Install (Coordinator only): `npm ci`
- Typecheck: `npm run typecheck`
- Unit tests (safe for parallel `share` workspaces): `npm test`
- Production build: `npm run build`
- Lovable ZIP package & verification: `npm run zip:lovable`

## Vertical Slice Ownership (`/swarm`)

- `calc-engine` (`workspace:"share"`): `src/domain/**` (pure TypeScript financial calculations, validation & Vitest unit tests).
- `backend-sync` (`workspace:"share"`): `supabase/functions/**`, `src/services/**`, `src/hooks/useAuth.ts`, `src/hooks/usePortfolioData.ts`.
- `ui-portfolio` (`workspace:"share"`): `src/components/layout/**`, `src/features/holdings/**`, `src/features/charts/**`, `src/features/stock-detail/**`.
- `ui-ledger` (`workspace:"share"`): `src/features/transactions/**`, `src/features/assets/**`, `src/features/dividends/**`, `src/features/settings/**`.
- `verifier` (`workspace:"inherit"`): Read-only code/RLS/DRY audit, sequential `npm run typecheck && npm test && npm run build && npm run zip:lovable`, and UI screenshot verification.

## Protected & Frozen Files

Coordinate via `@coordinator` before modifying any of these paths (blocked by `PreToolUse` in unattended `/swarm` runs; set `SWARM_GUARD_INTERACTIVE=1` only for single-session interactive scaffolding):

- `src/types/` (frozen domain & API contracts)
- `src/integrations/supabase/` (`client.ts`, generated `types.ts`)
- `supabase/migrations/` (forward migrations only when authorized)
- `supabase/config.toml`
- `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `vite.config.*`, `src/App.tsx`

## No-Touch Zones

- `Stockify/` (Android reference repo): Strictly read-only (`PreToolUse` denies any write or mutating shell command targeting it).
- `.env` / `.env.*` (excluding `.env.example`, `.env.sample`, `.env.template`): Never read or edit directly.
- `.agents/plugins/swarm-guardrails/`: Do not edit, disable, or delete active sprint guardrails.

## Lovable ZIP & Lovable Cloud Invariants

- `npm run zip:lovable` must exclude `node_modules/`, `dist/`, `.env*`, `.git/`, `.agents/` and stay under **250 MB**.
- All user-owned PostgreSQL tables (`accounts`, `transactions`, `bank_deposits`, `loans`, `user_settings`, `holdings_order`) require `user_id` + RLS policies (`auth.uid() = user_id`).
- All external market/FX/calendar/dividend API calls must execute through `supabase/functions/*` (never direct browser fetches to CORS-restricted TWSE/TPEx/Yahoo/Nasdaq endpoints).
- Frontend Supabase client must read `VITE_SUPABASE_PUBLISHABLE_KEY ?? VITE_SUPABASE_ANON_KEY`.

## Verification & Git Hygiene

- Commit finished slice work inside your `share` worktree before reporting `[done]`.
- Never run `git push`.
- Cite `#seq` numbers on the swarm board instead of pasting long logs; max 2–3 peer `@author <-> verifier` bounces before escalating to `@coordinator`.
