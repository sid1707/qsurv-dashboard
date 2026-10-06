# Handoff

Last updated: 2026-10-06

## Current status
MVP is built and deployed at https://qsurv-dashboard.vercel.app, connected to
Supabase project `xlpuxthmxcgkpfpxxpmn` (region ap-northeast-2, Seoul). All
migrations are applied to the hosted database. Locally: lint, typecheck,
`npm test` (470 tests, incl. DB tests on PGlite) and `npm run build` pass.

| Feature | Status |
|---|---|
| Onboarding, project approval, memberships/roles, kit panels | Done |
| Run upload, validation (+ split by date/site), approval + compilation | Done |
| Plots (lib/plots, admin + centre plots pages) | Built, uncommitted |
| Announcements | Done |
| Audit trail | Done: DB trigger audits every membership add/role change/removal |
| E2E (Playwright) | Written, never run (needs Docker + `supabase start`) |

## In progress right now
- Branch mvp-plots-audit-security, 4 commits on top of main (c0e0ca0):
  normalisation method, plots, audit + security, Playwright + vercel.json.
  Not pushed or merged yet; the live site runs c0e0ca0 until it is.

## Next steps
1. Merge the branch into main and deploy. Confirm `x-vercel-id` ends in
   `icn1` (if Hobby plan ignores vercel.json regions, set Settings → Functions).
2. Check the service-role key works in production: onboarding short-code check
   must not say "Project requests are not available right now".
3. Supabase Auth: Site URL = SITE_URL, redirect URL `<SITE_URL>/auth/accept`;
   set up custom SMTP (built-in mailer is rate-limited) before inviting users.
4. Run the E2E suite once on a machine with Docker; fix selectors (likely the
   plate-layout/rules steps and the placeholder-kit upload). See e2e/README.md.
5. Optional: audit log viewer for admins; CSP header.

## Known issues
- Not fixed from the security review: service-role client has no
  `server-only` guard; some API errors return raw DB messages; two
  simultaneous submits of one draft can both pass the draft check.
- `upload.*` audit events are writable by project admins via the API (the
  approve/reject functions run as the admin), so they are not forge-proof.

## Decisions made
- Roles live on project_memberships; RLS checks membership on every table.
- Projects addressed by `code`: /p/[code]/admin and /p/[code]/centre.
- Kit panels, plate layouts, fluorophores are DB data (super-admin/kits).
- Uploads: signed-URL flow (start → signed-url → validate → submit).
- Membership audits come from a DB trigger, not the app; the app only records
  `user.invited` (email sent). API audit inserts: project admins only, and
  never membership/project/project_request/kit event types.
- Centre users may write upload_files only while the batch is a draft and only
  inside its own folder (no file swap after validation). Results CSV max 5 MB.
- Security headers in next.config.ts. Vercel region icn1 (next to Supabase).
- E2E setup refuses any non-localhost Supabase URL.
- Middleware is proxy.ts (Next 16).

## Key files for the next task
- vercel.json, next.config.ts, .env.example (env: NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY, SITE_URL)
- supabase/migrations/20261006130000_membership_audit.sql,
  20261006140000_lock_submitted_upload_files.sql
- tests/db/audit.test.ts, tests/db/centre-uploads.test.ts
- playwright.config.ts, e2e/ (global-setup.ts, project-journey.spec.ts, README.md)
- lib/plots/, components/plots/, app/(app)/p/[code]/*/plots/
