import Link from "next/link"
import { buttonVariants } from "@/components/ui/button"
import { listKitsForAdmin } from "@/lib/kits/admin"
import { createClient } from "@/lib/supabase/server"

export default async function KitsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>
}) {
  const { saved } = await searchParams
  const kits = await listKitsForAdmin(await createClient())

  return (
    <div>
      {saved ? (
        <p role="status" className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          Kit saved.
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Kits define the targets, controls and plate layout used to validate uploads.
        </p>
        <Link href="/super-admin/kits/new" className={buttonVariants()}>
          Add kit
        </Link>
      </div>
      {kits.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No kits yet.</p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {kits.map((kit) => (
            <li key={kit.id}>
              <Link
                href={`/super-admin/kits/${kit.id}`}
                className="block h-full rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{kit.name}</span>
                  {!kit.active ? (
                    <span className="rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground">Inactive</span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Version {kit.version}</p>
                <p className="mt-3 text-sm text-muted-foreground">
                  {kit.targetCount} target{kit.targetCount === 1 ? "" : "s"} · used by {kit.projectCount} project
                  {kit.projectCount === 1 ? "" : "s"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
