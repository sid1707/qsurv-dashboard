import type { SupabaseClient } from "@supabase/supabase-js"

type Count = { count: number }[] | null
const count = (value: Count) => value?.[0]?.count ?? 0

export type ProjectListItem = {
  id: string
  code: string
  title: string
  status: string
  createdAt: string
  kitName: string | null
  centres: number
  users: number
  uploads: number
}

export async function listAllProjects(supabase: SupabaseClient): Promise<ProjectListItem[]> {
  const { data, error } = await supabase
    .from("projects")
    .select(
      "id, code, title, status, created_at, kit:kits(name), centres(count), project_memberships(count), upload_batches(count)"
    )
    .order("created_at", { ascending: false })
  if (error) throw new Error(`Could not load projects: ${error.message}`)

  return (data ?? []).map((p) => {
    const kit = Array.isArray(p.kit) ? p.kit[0] : p.kit
    return {
      id: p.id,
      code: p.code,
      title: p.title,
      status: p.status,
      createdAt: p.created_at,
      kitName: (kit as { name: string } | null)?.name ?? null,
      centres: count(p.centres as Count),
      users: count(p.project_memberships as Count),
      uploads: count(p.upload_batches as Count),
    }
  })
}
