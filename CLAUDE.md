# QSurv Portal

QSurv is a multi-project portal for multicentre qPCR surveillance. A nodal lab
requests a project through a public onboarding form. The super admin approves it.
The approved project gets its own workspace where centres upload qPCR run files
(fixed kit panel and plate layout) and the nodal lab validates, approves,
compiles and plots the data.

## Session start
- First read HANDOFF.md, then only the files needed for the current task.
- Don't explore the repo to "get oriented". Use the folder map below.
- If unsure which file to look at, ask the user instead of searching widely.

## Workspace
- qsurv-dashboard/ is this app. Write code only here.
- vrdl-next-platform/ is the reference app. READ ONLY. Never edit, commit or
  run migrations there. Copy patterns and code from it into qsurv-dashboard.
- Useful reference in vrdl-next-platform: lib/supabase (clients, session
  proxy), lib/auth (roles, authorization), lib/upload and app/api/uploads
  (signed-URL upload flow), components/admin/approval-queue.tsx,
  src/lib/validation and lib/compile (qPCR validation and compilation),
  lib/announcements, components/ui, docs/*.md.

## Folder map: qsurv-dashboard
```
proxy.ts                    * Next 16 session proxy (was middleware)
app/
  layout.tsx, page.tsx      * root layout, landing
  onboarding/               public project request form (+ received/)
  login/, auth/             sign-in, invite accept, set-password
  (app)/                    signed-in shell (layout.tsx)
    projects/               project picker
    super-admin/            requests/[id], projects, kits (+ actions.ts)
    p/[code]/admin/         project admin: approvals, centres, users,
                            compiled, announcements, settings (+ actions.ts)
    p/[code]/centre/        centre user: upload, uploads/[uploadId],
                            validation, announcements, profile (+ actions.ts)
  api/
    uploads/                signed-url, start, validate, submit
    projects/[code]/        uploads/[uploadId]/approve|reject, compiled/export
lib/
  supabase/                 browser/server/service-role clients, env, session
  auth/                     access rules, auth context, invites
  projects/                 project context, feature flags
  onboarding/               form schema, draft, submit
  super-admin/              request review, project creation
  kits/                     kit panel schema, admin CRUD, public reads
  plate/, rules/, qpcr/     plate layout, rule catalog, instrument formats
  upload/                   signed-URL upload flow, finalize, status
  validation/               qPCR parser + checks; split/ = split by date/site
  compile/                  approve + compile engine
  project-admin/            centres, users, approvals, compiled, settings
  centres/, announcements/  centre file names, announcements
  security/rate-limit.ts
components/
  ui/                       shadcn/base-ui primitives
  onboarding/, super-admin/, project-admin/, centre/, plate/, navigation/
supabase/migrations/        SQL migrations, timestamp-ordered (source of truth)
tests/                      Vitest unit tests (*.test.ts)
  db/                       DB/RLS tests (harness.ts)
  fixtures/runs/            sample qPCR run CSVs (generate.py)
```

## Stack (match vrdl-next-platform)
- Next.js 16 App Router, React 19, TypeScript, Tailwind 4, shadcn/base-ui.
- Next.js 16 has breaking changes (middleware is proxy.ts). Read the guide
  in node_modules/next/dist/docs/ before writing Next.js code.
- Supabase (Auth, Postgres, Storage) with row level security on every table.
- Vitest for tests. Scripts: `npm run lint`, `npm run typecheck`, `npm test`.

## Roles
- super_admin: global. Reviews project requests, manages kits and panels.
- project_admin: per project (the nodal lab).
- centre_user: per project and per centre.
Roles live on project_memberships(user_id, project_id, centre_id, role),
never on the user. One user can belong to several projects.

## Rules
- Every project-owned table has project_id, and its RLS policy checks
  project membership. Centre users only see their own centre's rows.
- Kit panels (targets, controls, plate layout, fluorophores) are data in
  the database, not hardcoded constants.
- Passwords go only to Supabase Auth. Never store them in our tables.
- The service-role key is used only in server code, never in the browser.
- Each feature ships with tests. Run lint, typecheck and tests before
  saying a step is done.

## Do not read unless asked
- node_modules/, .next/, .git/, coverage/, build output, tsconfig.tsbuildinfo,
  next-env.d.ts, lock files (package-lock.json, skills-lock.json).
- Generated/sample data: tests/fixtures/runs/ (sample qPCR run CSVs),
  onboarding-form-table.csv, public/ (images), supabase/.temp/.
- .claude/skills/ and .agents/skills/ (loaded via the Skill tool, not by hand).
- .env.local (secrets). Use .env.example for variable names.
- vrdl-next-platform/: read ONLY the specific paths in the "Useful reference"
  line, and only when the current task needs that pattern. Never scan it.
- node_modules/next/dist/docs/: open only the single guide relevant to the
  task (e.g. proxy, routing, caching). Don't read the whole folder.

## Ending a session
When the user says "wrap up" or "update handoff", rewrite HANDOFF.md to the
current state using its existing sections (Last updated, Current status, In
progress, Next steps, Known issues, Decisions, Key files). Keep it under ~60
lines; replace old detail rather than appending.
