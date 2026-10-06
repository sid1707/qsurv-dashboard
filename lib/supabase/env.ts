export function getSupabaseEnv() {
  // Referenced literally so Next.js inlines the public values into browser bundles.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Supabase's newer publishable key, falling back to the legacy anon key.
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) are required.",
    );
  }

  return { url, anonKey };
}
