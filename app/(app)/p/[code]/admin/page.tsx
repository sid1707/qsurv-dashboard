import Link from "next/link"
import { AlertTriangle, Clock } from "lucide-react"
import { projectAdminPath } from "@/lib/auth/access"
import { formatDateTimeIso, formatInteger } from "@/lib/format"
import { userTierLabel } from "@/lib/onboarding/labels"
import { loadOverview } from "@/lib/project-admin/overview"
import { requireProjectAdmin } from "@/lib/projects/context"
import { ADMIN_PAGES, enabledFeatureLabels } from "@/lib/projects/features"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

function StatTile({
  label,
  value,
  detail,
  href,
}: {
  label: string
  value: string
  detail?: React.ReactNode
  href?: string
}) {
  const body = (
    <>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
      {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
    </>
  )
  return href ? (
    <Link href={href} className="block rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50">
      {body}
    </Link>
  ) : (
    <div className="rounded-lg border bg-card p-4">{body}</div>
  )
}

export default async function ProjectOverviewPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const { project, features } = await requireProjectAdmin(code, { pages: ADMIN_PAGES, page: "" })
  const overview = await loadOverview(await createClient(), project.id, project.user_tier)
  const { seats } = overview
  const tracksUploads = features.data_management

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Overview</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Enabled: {enabledFeatureLabels(features).join(", ") || "none"}
        </p>
      </div>

      <section aria-label="Key figures" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Centres"
          value={formatInteger(overview.centres.active)}
          detail={
            overview.centres.total > overview.centres.active
              ? `active, ${overview.centres.total - overview.centres.active} deactivated`
              : "active"
          }
          href={projectAdminPath(project.code, "centres")}
        />
        <StatTile
          label="Users"
          value={formatInteger(seats.used)}
          detail={
            seats.limit === null ? (
              "No user limit"
            ) : seats.full ? (
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                <AlertTriangle className="size-3.5" aria-hidden /> Limit of {seats.limit} reached
              </span>
            ) : (
              `of ${seats.limit} (${userTierLabel(project.user_tier)}), ${seats.remaining} left`
            )
          }
          href={projectAdminPath(project.code, "users")}
        />
        {tracksUploads ? (
          <>
            <StatTile label="Uploads this month" value={formatInteger(overview.uploadsThisMonth)} detail="Submitted run files" />
            <StatTile
              label="Pending approvals"
              value={formatInteger(overview.pendingApprovals)}
              detail={
                overview.pendingApprovals > 0 ? (
                  <span className="inline-flex items-center gap-1 font-medium text-foreground">
                    <Clock className="size-3.5" aria-hidden /> Waiting for review
                  </span>
                ) : (
                  "Nothing waiting"
                )
              }
              href={projectAdminPath(project.code, "approvals")}
            />
          </>
        ) : null}
      </section>

      <section className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h3 className="font-semibold">Centres</h3>
          <p className="text-xs text-muted-foreground">
            {tracksUploads ? "Most recent upload per centre. Months follow India time." : "Users per centre."}
          </p>
        </div>
        {overview.activity.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No centres yet.{" "}
            <Link href={projectAdminPath(project.code, "centres")} className="underline underline-offset-4">
              Add a centre
            </Link>
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th scope="col" className="px-4 py-2 font-medium">Centre</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Users</th>
                  {tracksUploads ? (
                    <>
                      <th scope="col" className="px-4 py-2 text-right font-medium">This month</th>
                      <th scope="col" className="px-4 py-2 text-right font-medium">Pending</th>
                      <th scope="col" className="px-4 py-2 font-medium">Last upload</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {overview.activity.map((c) => (
                  <tr key={c.centreId} className="border-b last:border-0">
                    <td className="px-4 py-2">
                      {c.centreName}
                      {!c.active ? <span className="ml-2 text-xs text-muted-foreground">(deactivated)</span> : null}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{c.users}</td>
                    {tracksUploads ? (
                      <>
                        <td className="px-4 py-2 text-right tabular-nums">{c.uploadsThisMonth}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{c.pendingApprovals}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
                          {c.lastUploadAt ? formatDateTimeIso(c.lastUploadAt) : "No uploads yet"}
                        </td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
