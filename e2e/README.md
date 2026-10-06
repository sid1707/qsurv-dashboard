# End-to-end tests

One journey, in order: request a project → super admin approves → admin
invites a centre user → centre user accepts and uploads a run → admin approves
and finds it in the compiled data. Each step also checks the audit trail.

## Run locally

Needs Docker for the local Supabase stack.

```sh
npx supabase start            # applies supabase/migrations; prints the keys
npx playwright install chromium
```

Point the app at the local stack, either in `.env.local` or in the shell
(`npx supabase status` shows the values):

```sh
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable / anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
```

Then `npm run test:e2e`. Playwright starts `next dev` on port 3000 (or reuses
one already running) and sets `SITE_URL` so invite links come back to it.

The setup refuses any Supabase URL that is not localhost, so it cannot write
to a hosted project by accident. It creates `e2e-super-admin@qsurv.test` and
activates the "Huwel Multipathogen" placeholder kit, which the sample runs in
`tests/fixtures/runs` were made for. Invite emails are read from Mailpit
(port 54324). Every run uses a new project code, so runs can repeat without
resetting the database (`npx supabase db reset` clears everything).

Options: `E2E_BASE_URL` (test an already running app), `E2E_PORT`,
`E2E_MAILPIT_URL`, `E2E_SUPER_ADMIN_EMAIL` / `E2E_SUPER_ADMIN_PASSWORD`.
