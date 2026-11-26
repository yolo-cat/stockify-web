---
name: security-maintenance
description: >-
  Use this skill when running scheduled or manual security and code-quality
  maintenance for yolo-cat/stockify-web in the security_audit_workflow worktree
  to triage GitHub Security alerts, proactively resolve and auto-merge all
  eligible low-risk items, track work in GitHub Issues, and gate high-risk
  changes for human review.
---

# Stockify Security & Quality Maintenance Runbook

Execute this workflow inside `/Users/joseph-m2/.gemini/antigravity/worktrees/stockify-web/security_audit_workflow` for `yolo-cat/stockify-web` (`main`).

## 1. Align Worktree & Bootstrap Dependencies

1. Check `git status --short`. If dirty, stop without mutating files and report the dirty state.
2. Fetch and check divergence: `git fetch origin main && git rev-list --left-right --count origin/main...HEAD`.
3. If `0` local commits are ahead of `origin/main`, align cleanly:
   `git checkout security_audit_workflow && git reset --hard origin/main`.
   If local unpushed commits exist, do not reset—report and stop.
4. Ensure dependencies are installed before local verification: `[ -d node_modules ] || npm ci`.

## 2. Tier 0 Zero-LLM CLI Gate

Always single-quote `gh api` paths containing `?` in zsh:

- `gh api 'repos/yolo-cat/stockify-web/code-scanning/alerts?state=open'`
- `gh api 'repos/yolo-cat/stockify-web/dependabot/alerts?state=open'`
- `gh api 'repos/yolo-cat/stockify-web/secret-scanning/alerts?state=open'`
- `gh pr list -R yolo-cat/stockify-web --state open --json number,title,headRefName,labels,isDraft,mergeable`
- `gh issue list -R yolo-cat/stockify-web --state open --label security-maintenance --json number,title,body,labels`

If there are 0 open alerts, 0 open security/dependency PRs, and 0 actionable tracked issues, output an "All clear" summary and exit immediately.

## 3. Idempotent GitHub Issue Tracking

1. Ensure labels exist via `gh label create <name> -R yolo-cat/stockify-web --force`:
   `security-maintenance`, `security`, `quality`, `risk:low`, `risk:high`, `needs-human-review`.
2. Group alerts by rule or package family using a stable body marker:
   - `<!-- security-key:codeql:<rule-id> -->`
   - `<!-- security-key:dependabot:<pkg-or-group> -->`
   - `<!-- security-key:secret-scanning:<alert-id> -->`
3. Search existing open issues for the matching `security-key` before creating a new issue; comment/update instead of duplicating.
4. **Shell safety**: When issue or PR bodies contain `<` or `>` (HTML tags, regexes, or comment markers), write the markdown to a scratch file and pass `--body-file <path>` so pre-tool hooks do not misinterpret `>` as output redirection.

## 4. Proactive Low-Risk Exhaustion & `/swarm-planner` Token-Efficient Routing

**Core rule: Do NOT passively defer eligible low-risk items.** Within a single maintenance run, drain **all** open low-risk items—including open low-risk Dependabot alerts that do not yet have a Dependabot PR—before finishing.

Never spawn `/swarm` automatically in unattended runs. Route each grouped item to the lightest tier:

- **Tier 1 (Single-Session Direct Fix — Default for ALL Low-Risk Items)**:
  - Eligible low-risk scope:
    1. Localized security/quality code fixes (`<= 5` files, NOT touching auth/RLS, `supabase/migrations/*`, `src/types/*`, `src/integrations/supabase/*`, `src/App.tsx`, or read-only `Stockify/`).
    2. Non-major runtime dependency security updates (whether a Dependabot PR exists or not).
    3. Any `devDependencies` security updates—**including major `devDependencies` upgrades** (e.g., `vitest`, `tinypool`, `@vitest/mocker`)—**even if Dependabot has not opened a PR yet**.
  - For items without an open PR: cut a fresh branch off `origin/main` (`sec/<slug>-<YYYYMMDD>`), apply the code fix or dependency upgrade (`npm install -D <pkg>@<patched-range>` / `npm update`), verify locally, commit, push, and open a PR referencing the tracked Issue (`Refs #<id>` so the Issue closes only after Step 6 board reconciliation).
  - For an existing Dependabot PR with 0 CI checks (opened before `.github/workflows/ci.yml` landed): comment `@dependabot rebase`, wait for rebase + CI, and never merge with 0 CI checks.
- **Tier 2 (Lightweight Read-Only `/run-workflow`)**:
  - Only when newly opened alerts span `> 3` unrelated modules, run one read-only `run_workflow` pass (`type_name="research"`, `workspace="inherit"`, `model="flash_lite"` or `"flash"`, strict JSON schema) to map root causes before applying Tier 1 fixes or logging issues.
- **Tier 3 (Human-Gated Issue Only — Never Auto-Merge)**:
  - Runtime **major** dependency upgrades (e.g., `react-router` v6 -> v7), auth/RLS/DB migrations, frozen contracts (`src/types/*`, `src/integrations/supabase/*`, `src/App.tsx`), changes spanning `> 5` files, or any Secret Scanning alert.
  - Post root-cause impact analysis, verification notes, and a concise `/swarm-planner` blueprint on the tracked Issue/PR, label `risk:high` and `needs-human-review`, and leave for human approval.

## 5. Verification Gate & Low-Risk Auto-Merge

1. Local 4-step verification (all 4 must pass):
   `npm run typecheck && npm test && npm run build && npm run zip:lovable`
2. Remote CI verification:
   Watch checks via `gh pr checks <num> -R yolo-cat/stockify-web --watch --interval 10`.
3. Auto-merge via `gh pr merge <num> -R yolo-cat/stockify-web --squash --delete-branch` **ONLY when ALL hold**:
   - Item matches Tier 1 low-risk scope;
   - Local 4-step verification passed;
   - GitHub Actions CI checks exist on the PR and all passed (`SUCCESS`, 0 failing, 0 pending);
   - PR is `MERGEABLE` and not a draft.
4. Post verification evidence and merge commit SHA to the tracked Issue, then proceed to Step 6 board reconciliation **before** finalizing closure (if `Fixes #<id>` auto-closed the Issue and Step 6 finds the alert still `open`, reopen the Issue via `gh issue reopen`). If any check fails on a proactive low-risk upgrade (e.g., breaking `vitest` v4 test incompatibility), leave the PR as draft or close it, document the exact failure on the tracked Issue, add `needs-human-review`, and continue to remaining low-risk items.

## 6. GitHub Security & Quality Board Reconciliation (Mandatory Sign-Off)

Merging a PR does **not** complete the task—every resolved item must be reconciled against the GitHub Security & Quality dashboard before closing out:

1. **CodeQL (Security & Quality rules)**:
   - After merge to `main`, watch the default-branch CodeQL run:
     `gh run list -R yolo-cat/stockify-web --workflow CodeQL --branch main --limit 1` + `gh run watch <run-id> -R yolo-cat/stockify-web`.
   - Query `gh api 'repos/yolo-cat/stockify-web/code-scanning/alerts?state=open'` and `?state=fixed` to confirm every targeted alert number transitioned to `state: "fixed"` with a `fixed_at` timestamp.
2. **Dependabot (`dependabot/alerts`)**:
   - After merging a `package.json` / `package-lock.json` fix to `main`, query `gh api 'repos/yolo-cat/stockify-web/dependabot/alerts?state=open'` and `?state=fixed` to confirm all targeted alert numbers transitioned to `state: "fixed"` with `fixed_at`.
   - Because GitHub's dependency graph refresh can lag 1–5 minutes asynchronously, recheck after a bounded wait; if still re-indexing, comment `pending-board-reconciliation` on the Issue and keep it open (or verify and close on the next run) rather than assuming closure.
3. **Failure & Non-Dismissal Policy**:
   - If a targeted alert remains `open` after the post-merge scan finishes (e.g., incomplete fix or remaining transitive vulnerability), do **not** close the Issue (reopen it if auto-closed) and do **not** `dismiss` the alert; either apply a Tier 1 follow-up fix or label `needs-human-review`.
4. **Issue Sign-Off Record**:
   - Post a compact reconciliation table (`Alert # | Board | State | fixed_at | Merge Commit`) on the tracked GitHub Issue and close the Issue only after reconciliation passes.

## 7. Clean Teardown & Summary

Return cleanly to `security_audit_workflow` aligned with latest `origin/main` (`git fetch origin main && git checkout security_audit_workflow && git reset --hard origin/main && git status -sb`) and output a concise Markdown summary table of alerts triaged, low-risk items resolved/merged, board alerts reconciled (`fixed`), high-risk items deferred, and execution tiers used.
