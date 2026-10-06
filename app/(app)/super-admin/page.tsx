import Link from "next/link"
import { buttonVariants } from "@/components/ui/button"
import { projectDashboardPath } from "@/lib/auth/access"
import { formatDateFromDb } from "@/lib/format"
import { REQUEST_STATUSES, listRequests, parseStatus } from "@/lib/super-admin/requests"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

const STATUS_LABELS = { pending: "Pending", approved: "Approved", rejected: "Rejected" } as const

function param(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined
}

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const status = parseStatus(param(params.status))
  const approved = param(params.approved)
  const approvedProject = param(params.project)
  const rejected = param(params.rejected)
  const requests = await listRequests(await createClient(), status)

  return (
    <div>
      {approved ? (
        <p role="status" className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          Request {approved} approved. The project is live and the admin can now sign in.
          {approvedProject ? (
            <>
              {" "}
              <Link href={projectDashboardPath(approvedProject)} className="font-medium underline">
                Open {approvedProject}
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {rejected ? (
        <p role="status" className="mb-4 rounded-md border p-3 text-sm">
          Request {rejected} rejected. The admin account stays blocked.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {REQUEST_STATUSES.map((s) => (
          <Link
            key={s}
            href={s === "pending" ? "/super-admin" : `/super-admin?status=${s}`}
            aria-current={s === status ? "page" : undefined}
            className={buttonVariants({ variant: s === status ? "secondary" : "ghost", size: "sm" })}
          >
            {STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      {requests.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          {status === "pending" ? "No project requests are waiting for review." : `No ${status} requests.`}
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm text-muted-foreground">
            {requests.length} {status} request{requests.length === 1 ? "" : "s"}
            {status === "pending" ? ", oldest first" : ""}
          </p>
          <ul className="mt-3 space-y-3">
            {requests.map((r) => (
              <li key={r.id} className="rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {r.project_title}
                      {r.requested_code ? (
                        <span className="ml-2 font-mono text-xs text-muted-foreground">{r.requested_code}</span>
                      ) : null}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {r.institution_name}
                      {r.city ? `, ${r.city}` : ""}
                      {r.state ? `, ${r.state}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.requester_name} · {r.requester_email}
                      {r.expected_centre_count ? ` · ${r.expected_centre_count} centres` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2 text-right">
                    <span className="font-mono text-xs text-muted-foreground">{r.reference}</span>
                    <span className="text-xs text-muted-foreground">
                      {status === "pending"
                        ? `Submitted ${formatDateFromDb(r.created_at)}`
                        : `Reviewed ${formatDateFromDb(r.reviewed_at)}`}
                    </span>
                    <Link
                      href={`/super-admin/requests/${r.id}`}
                      className={cn(buttonVariants({ variant: status === "pending" ? "default" : "outline", size: "sm" }))}
                    >
                      {status === "pending" ? "Review" : "View"}
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
