import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { PGlite, type Transaction } from "@electric-sql/pglite"

const MIGRATIONS_DIR = path.resolve(__dirname, "../../supabase/migrations")

/**
 * Minimal stand-ins for the parts of a Supabase database the migrations rely on:
 * API roles, auth.users + auth.uid(), and the storage bucket/object tables
 * (which have RLS enabled in real Supabase).
 */
const SUPABASE_STUB_SQL = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;

  grant usage on schema public to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;

  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    raw_app_meta_data jsonb not null default '{}'::jsonb,
    banned_until timestamptz,
    invited_at timestamptz,
    last_sign_in_at timestamptz
  );

  create function auth.uid() returns uuid
  language sql stable
  as $$
    select nullif(
      coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
      ),
      ''
    )::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;

  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean not null default false
  );

  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id),
    name text not null,
    owner uuid,
    created_at timestamptz not null default now()
  );
  alter table storage.objects enable row level security;
  grant select on storage.buckets to anon, authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
  grant all on storage.buckets, storage.objects to service_role;
`

export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
}

export async function createMigratedDb() {
  const db = new PGlite()
  await db.exec(SUPABASE_STUB_SQL)
  for (const file of migrationFiles()) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8")
    try {
      await db.exec(sql)
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`)
    }
  }
  return db
}

type Role = "anon" | "authenticated" | "service_role"

/**
 * Runs fn as an API role with the given user's JWT claims, then rolls back so
 * tests never leak writes into each other.
 */
export async function runAs<T>(
  db: PGlite,
  role: Role,
  userId: string | null,
  fn: (tx: Transaction) => Promise<T>
): Promise<T> {
  let result: T | undefined
  let failure: unknown
  let failed = false
  await db
    .transaction(async (tx) => {
      await tx.exec(`set local role ${role}`)
      const claims = userId ? JSON.stringify({ sub: userId, role }) : ""
      await tx.query("select set_config('request.jwt.claims', $1, true)", [claims])
      try {
        result = await fn(tx)
      } catch (error) {
        failure = error
        failed = true
      }
      await tx.rollback()
    })
    .catch(() => {
      // rollback() rejects the transaction promise; the outcome is captured above.
    })
  if (failed) throw failure
  return result as T
}
