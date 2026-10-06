# Handoff

Last updated: 2026-10-06 (inferred from file names and git, not from running the code)

## Current status
Status is inferred from which files and migrations exist. Nothing has been run.
| Feature | Status | Evidence |
|---|---|---|
| Onboarding form | Built | app/onboarding, lib/onboarding, migration onboarding_v2 |
| Project approval | Built | super-admin/requests/[id], lib/super-admin |
| Memberships / roles | Built | lib/auth, migration core_identity, tests/db/rls |
| Kit panels | Built | super-admin/kits, lib/kits, migration kit_control_types |
| Run upload | Built | app/api/uploads/*, lib/upload, migration centre_uploads |
| Validation | Built | lib/validation (+ split/), tests/validation-* |
| Approval + compilation | Built most recently | lib/compile, migration 20261006 upload_approval_and_compile |
| Plots | Not started? | no chart code found. TODO: confirm with user |
| Announcements | Built? | lib/announcements, admin + centre pages. TODO: confirm with user |

## In progress right now
- Branch: main. One commit (8270050 "first-commit"), and it holds only README.md.
- Everything else is untracked: app/, lib/, components/, supabase/, tests/, config.
- Unfinished work: TODO: confirm with user (probably polishing approval/compile).

## Next steps
1. Commit the untracked work in logical chunks (check that .env.local stays ignored).
2. Run `npm run lint && npm run typecheck && npm test`. Record the results here.
3. Check that the 20261006 approval/compile migration and tests/db/upload-approval pass.
4. Build plots on top of compiled data (lib/project-admin/compiled.ts).
5. TODO: confirm with user what the next priority is.

## Known issues / failing tests
- TODO: confirm with user. The test suite was not run while writing this.
- tests/db/* need a local Supabase (supabase start). TODO: confirm with user

## Decisions made
- Roles live on project_memberships, never on users. RLS checks membership on every table.
- Projects are addressed by a `code` in URLs: /p/[code]/admin and /p/[code]/centre.
- Kit panels, controls, plate layouts and fluorophores are DB data, edited in super-admin/kits.
- Uploads use a signed-URL flow (start -> signed-url -> validate -> submit), copied from vrdl.
- Validation can split one run file by date or by site/identifier (lib/validation/split).
- Centre file names follow a convention (lib/centres/file-name.ts), e.g.
  C01_HuwelLab_Pune_01102026_quantstudio5.csv.
- Middleware is proxy.ts (Next 16).

## Key files for the next task
- lib/compile/engine.ts, lib/compile/approve.ts
- lib/project-admin/compiled.ts, app/(app)/p/[code]/admin/compiled/page.tsx
- app/api/projects/[code]/compiled/export/route.ts
- supabase/migrations/20261006120000_upload_approval_and_compile.sql
- tests/compile-engine.test.ts, tests/upload-approval.test.ts, tests/db/upload-approval.test.ts
