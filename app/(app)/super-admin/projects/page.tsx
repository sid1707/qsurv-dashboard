import Link from "next/link"
import { projectDashboardPath } from "@/lib/auth/access"
import { formatDateFromDb, formatInteger } from "@/lib/format"
import { listAllProjects } from "@/lib/super-admin/projects"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

const STATUS_STYLES: Record<string, string> = {
  active: "border-emerald-300 text-emerald-800 dark:border-emerald-800 dark:text-emerald-300",
  suspended: "border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-300",
  archived: "text-muted-foreground",
}

export default async function ProjectsAdminPage() {
  const projects = await listAllProjects(await createClient())

  if (projects.length === 0) {
    return <p className="text-sm text-muted-foreground">No projects yet. Approved requests appear here.</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Project</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Kit</th>
            <th className="px-4 py-2 text-right font-medium">Centres</th>
            <th className="px-4 py-2 text-right font-medium">Users</th>
            <th className="px-4 py-2 text-right font-medium">Uploads</th>
            <th className="px-4 py-2 font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id} className="border-t">
              <td className="px-4 py-3">
                <Link href={projectDashboardPath(p.code)} className="font-medium hover:underline">
                  {p.title}
                </Link>
                <div className="font-mono text-xs text-muted-foreground">{p.code}</div>
              </td>
              <td className="px-4 py-3">
                <span className={cn("rounded-md border px-1.5 py-0.5 text-xs capitalize", STATUS_STYLES[p.status])}>
                  {p.status}
                </span>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{p.kitName ?? "—"}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatInteger(p.centres)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatInteger(p.users)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatInteger(p.uploads)}</td>
              <td className="px-4 py-3 text-muted-foreground">{formatDateFromDb(p.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
