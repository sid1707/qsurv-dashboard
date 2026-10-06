import Link from "next/link"
import { DeleteUploadButton } from "@/components/centre/centre-actions"
import { UploadStatusBadge } from "@/components/centre/upload-status-badge"
import { projectCentrePath } from "@/lib/auth/access"
import { formatDateFromDb, formatDateTimeIso } from "@/lib/format"
import { requireCentreUser } from "@/lib/projects/context"
import { CENTRE_PAGES } from "@/lib/projects/features"
import { INSTRUMENT_PROFILES, isInstrumentId } from "@/lib/qpcr/instruments"
import { listCentreUploads } from "@/lib/upload/queries"
import { canDeleteUpload } from "@/lib/upload/status"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export default async function MyUploadsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const { project, centre, user } = await requireCentreUser(code, { pages: CENTRE_PAGES, page: "uploads" })
  const uploads = await listCentreUploads(await createClient(), project.id, centre.id)
  const base = projectCentrePath(project.code, "uploads")

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">My uploads</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your centre&apos;s uploads and where each one is. Uploads awaiting approval can still be deleted.
          </p>
        </div>
        {centre.active ? (
          <Link href={projectCentrePath(project.code, "upload")} className="text-sm underline underline-offset-4">
            Upload a run
          </Link>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th scope="col" className="px-3 py-2 font-medium">Results file</th>
              <th scope="col" className="px-3 py-2 font-medium">Collected</th>
              <th scope="col" className="px-3 py-2 font-medium">Uploaded</th>
              <th scope="col" className="px-3 py-2 font-medium">Status</th>
              <th scope="col" className="px-3 py-2 font-medium">Validation</th>
              <th scope="col" className="px-3 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {uploads.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  No uploads yet.
                </td>
              </tr>
            ) : (
              uploads.map((u) => (
                <tr key={u.id} className="border-b last:border-0 align-top">
                  <td className="px-3 py-2">
                    <Link href={`${base}/${u.id}`} className="break-all underline underline-offset-4">
                      {u.resultsFilename ?? "Upload (no file saved)"}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {isInstrumentId(u.instrument) ? INSTRUMENT_PROFILES[u.instrument].label : u.instrument ?? "—"}
                    </p>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateFromDb(u.sample_collection_date)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTimeIso(u.submitted_at ?? u.created_at)}</td>
                  <td className="px-3 py-2">
                    <UploadStatusBadge batch={u} />
                    {u.rejection_reason ? <p className="mt-1 max-w-xs text-xs text-muted-foreground">{u.rejection_reason}</p> : null}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {u.latestRun ? (
                      <Link href={`${base}/${u.id}#validation`} className="underline underline-offset-4">
                        {u.latestRun.passed ? "Passed" : "Failed"}
                        {u.latestRun.warning_count > 0
                          ? `, ${u.latestRun.warning_count} warning${u.latestRun.warning_count === 1 ? "" : "s"}`
                          : ""}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {canDeleteUpload(u) ? (
                      <DeleteUploadButton code={project.code} uploadId={u.id} label={u.resultsFilename ?? "This upload"} />
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Signed in as {user.email}.</p>
    </div>
  )
}
