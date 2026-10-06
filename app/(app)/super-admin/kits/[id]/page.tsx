import { notFound } from "next/navigation"
import { KitEditor } from "@/components/super-admin/kit-editor"
import { getKitForEdit } from "@/lib/kits/admin"
import { createClient } from "@/lib/supabase/server"

export default async function EditKitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const kit = await getKitForEdit(await createClient(), id)
  if (!kit) notFound()

  return <KitEditor title={`Edit ${kit.values.name}`} initial={kit.values} projectCount={kit.projectCount} />
}
