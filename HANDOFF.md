# Handoff

Last updated: 2026-10-06 (end of day)

## Current status
MVP is live at https://qsurv-dashboard.vercel.app on the latest `main`.
Supabase `vvffarfivshebmwqaygj` (ap-south-1, Mumbai), migrations applied;
Vercel functions in bom1 (x-vercel-id `bom1::bom1`). Locally: lint,
typecheck, `npm test` (470 tests) and `npm run build` pass.
Built: onboarding, project approval, roles, kits, upload + validation,
approval + compilation (choice of normalisation method), plots,
announcements, audit trail. E2E (Playwright) is written but never run.

## In progress right now
- Moving off the old Seoul project `xlpuxthmxcgkpfpxxpmn`: the site already
  uses Mumbai; sign-in on the new project is not verified yet (step 1).
- Only uncommitted change: this file. Work on `main` only, no branches.

## Next steps (in order)
1. Finish the Mumbai switch, in the new Supabase project:
   a. Auth → URL Configuration: Site URL `https://qsurv-dashboard.vercel.app`,
      redirect `https://qsurv-dashboard.vercel.app/auth/accept`.
   b. Create the super admin (sign up or add user), then in SQL editor:
      `update public.profiles set is_super_admin = true where user_id =
      (select id from auth.users where email = '<email>');` and sign in.
   c. `/onboarding` project step: short-code check must NOT say "Project
      requests are not available right now" (else service-role key is wrong).
2. Pause the Seoul project; delete it after a week or two if nothing is missing.
3. Before inviting real users: custom SMTP in Supabase Auth (built-in mailer
   is rate-limited), and edit the invite email template if wanted.
4. Decide which security-review items to fix (user has not decided yet):
   - Recommended, ~1 hour together: (a) `server-only` guard on
     lib/supabase/service-role.ts; (b) atomic claim in submit so two
     simultaneous submits of one draft can't both run; (c) make `upload.*`
     audit events forge-proof (approve/reject write audit via a definer helper,
     then reserve `upload.%`) if the audit log may be used as evidence.
   - Low priority: generic API error messages (log raw DB errors server-side).
   - Only if needed: allow embedding the portal in an iframe (X-Frame-Options).
5. Run the E2E suite on a machine with Docker (`npx supabase start`, then
   `npm run test:e2e`); expect selector fixes. See e2e/README.md.
6. Later: audit log viewer for admins; CSP header; move the repo out of
   OneDrive (it locks folders during git checkout and slows builds).

## Known issues
- See 4: no server-only guard, raw DB errors in some API responses, submit
  race, `upload.*` audit rows writable by project admins via the API.

## Decisions made
- Roles live on project_memberships; RLS checks membership on every table.
- Projects addressed by `code`: /p/[code]/admin and /p/[code]/centre.
- Kits, plate layouts, fluorophores are DB data (super-admin/kits).
- Uploads: signed-URL flow (start → signed-url → validate → submit).
- Membership changes audited by a DB trigger; the app only records
  `user.invited`. API audit inserts: project admins only, never DB-owned types.
- Centre users write upload_files only while the batch is a draft, inside its
  own folder. Results CSV max 5 MB. Security headers in next.config.ts.
- Supabase in Mumbai + Vercel bom1 (users are in India).
- Work on `main` only; pushing `main` deploys production. User's shell is
  PowerShell (avoid `echo >>`, it writes UTF-16).

## Key files for the next task
- lib/supabase/service-role.ts, lib/upload/finalize.ts, app/api/uploads/*
- supabase/migrations/20261006120000_upload_approval_and_compile.sql
  (approve_upload/reject_upload), 20261006130000_membership_audit.sql
- vercel.json, next.config.ts, .env.example, e2e/README.md
