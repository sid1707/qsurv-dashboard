import Link from "next/link"
import { projectCentrePath } from "@/lib/auth/access"
import { formatDateFromDb, formatDateTimeIso } from "@/lib/format"
import { requireCentreUser } from "@/lib/projects/context"
import { CENTRE_PAGES } from "@/lib/projects/features"
import { listCentreValidationIssues } from "@/lib/upload/queries"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

/** The AMR validation summary: every warning recorded for the centre's uploads. */
export default async function ValidationResultsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const { project, centre } = await requireCentreUser(code, { pages: CENTRE_PAGES, page: "validation" })
  const rows = await listCentreValidationIssues(await createClient(), project.id, centre.id)
  const base = projectCentrePath(project.code, "uploads")

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Validation results</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Warnings recorded for your centre&apos;s submitted uploads, newest first. Files with errors are never
          submitted, so their errors show on the upload page while you fix them.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th scope="col" className="px-3 py-2 font-medium">When</th>
              <th scope="col" className="px-3 py-2 font-medium">Check</th>
              <th scope="col" className="px-3 py-2 font-medium">Message</th>
              <th scope="col" className="px-3 py-2 font-medium">Results file</th>
              <th scope="col" className="px-3 py-2 font-medium">Upload</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  No warnings yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTimeIso(r.created_at)}</td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs">{r.issue_code}</span>
                    {r.severity === "error" ? <span className="ml-1 text-xs text-destructive">(error)</span> : null}
                  </td>
                  <td className="px-3 py-2 whitespace-pre-wrap">
                    {r.well ? <span className="text-muted-foreground">Well {r.well}: </span> : null}
                    {r.message}
                  </td>
                  <td className="px-3 py-2">
                    <span className="break-all">{r.resultsFilename ?? "—"}</span>
                    <p className="text-xs text-muted-foreground">Collected {formatDateFromDb(r.sample_collection_date)}</p>
                  </td>
                  <td className="px-3 py-2">
                    {r.upload_batch_id ? (
                      <Link href={`${base}/${r.upload_batch_id}#validation`} className="underline underline-offset-4">
                        Open
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
