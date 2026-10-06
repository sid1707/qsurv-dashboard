import { createClient } from "@supabase/supabase-js"

/**
 * Server-only client that bypasses RLS. Requires SUPABASE_SERVICE_ROLE_KEY.
 * Never import this from a client component.
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return null
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
