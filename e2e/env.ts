import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { createClient } from "@supabase/supabase-js"

/** Loads .env.local into process.env (without overriding anything already set). */
function loadEnvFile() {
  const file = path.resolve(__dirname, "../.env.local")
  if (!existsSync(file)) return
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "")
  }
}
loadEnvFile()

function required(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set. The E2E tests need a local Supabase; see e2e/README.md.`)
  return value
}

export const SUPABASE_URL = required("NEXT_PUBLIC_SUPABASE_URL")
/** Mailpit, which `supabase start` runs to catch auth emails (inbucket port in supabase/config.toml). */
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324"

export const SUPER_ADMIN = {
  email: process.env.E2E_SUPER_ADMIN_EMAIL ?? "e2e-super-admin@qsurv.test",
  password: process.env.E2E_SUPER_ADMIN_PASSWORD ?? "e2e-super-admin-password",
}

/** The seeded placeholder kit the sample runs in tests/fixtures/runs were generated for. */
export const E2E_KIT = { name: "Huwel Multipathogen", version: "0.1-placeholder" }

/**
 * Service-role client for test setup only. Refuses anything but a local
 * Supabase so the suite can never write to a hosted project.
 */
export function serviceClient() {
  const host = new URL(SUPABASE_URL).hostname
  if (!["127.0.0.1", "localhost"].includes(host) && process.env.E2E_ALLOW_REMOTE !== "1") {
    throw new Error(`Refusing to run E2E setup against ${SUPABASE_URL}. Point .env.local at \`supabase start\`.`)
  }
  return createClient(SUPABASE_URL, required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
