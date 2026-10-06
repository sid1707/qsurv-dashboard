import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { DeleteUploadButton } from "@/components/centre/centre-actions"
import { UploadStatusBadge } from "@/components/centre/upload-status-badge"
import { IssueList } from "@/components/centre/validation-results"
import { Panel } from "@/components/project-admin/form"
import { projectCentrePath } from "@/lib/auth/access"
import { formatDateFromDb, formatDateTimeIso } from "@/lib/format"
import { requireCentreUser } from "@/lib/projects/context"
import { CENTRE_PAGES } from "@/lib/projects/features"
import { INSTRUMENT_PROFILES, isInstrumentId } from "@/lib/qpcr/instruments"
import { getUploadDetail, type UploadIssue } from "@/lib/upload/queries"
import { canDeleteUpload } from "@/lib/upload/status"
import { createClient } from "@/lib/supabase/server"
import type { ValidationIssue } from "@/lib/validation/types"

export const dynamic = "force-dynamic"

const FILE_LABELS: Record<string, string> = { results: "Results export", runfile: "Run file", metadata: "Metadata" }

const toIssue = (i: UploadIssue): ValidationIssue => ({
  rowNumber: i.record_index,
  fieldName: i.field_name ?? "",
  errorCode: i.issue_code,
  errorMessage: i.message,
  severity: i.severity === "error" ? "error" : "warning",
  well: i.well,
  targetName: i.target_name,
})

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}

export default async function UploadDetailPage({ params }: { params: Promise<{ code: string; uploadId: string }> }) {
  const { code, uploadId } = await params
  const { project, centre } = await requireCentreUser(code, { pages: CENTRE_PAGES, page: "uploads" })
  const upload = await getUploadDetail(await createClient(), project.id, centre.id, uploadId)
  if (!upload) notFound()

  const results = upload.files.find((f) => f.file_kind === "results")
  const errors = upload.issues.filter((i) => i.severity === "error").map(toIssue)
  const warnings = upload.issues.filter((i) => i.severity === "warning").map(toIssue)
  const details = upload.issues.filter((i) => i.severity === "detail").map((i) => i.message)
  const listHref = projectCentrePath(project.code, "uploads")

  return (
    <div className="space-y-6">
      <div>
        <Link href={listHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> My uploads
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-xl font-semibold break-all">{results?.original_filename ?? "Upload"}</h2>
          {canDeleteUpload(upload) ? (
            <DeleteUploadButton code={project.code} uploadId={upload.id} label={results?.original_filename ?? "This upload"} after={listHref} />
          ) : null}
        </div>
      </div>

      <Panel title="Status">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Item label="Status">
            <UploadStatusBadge batch={upload} />
          </Item>
          <Item label={(upload.sample_collection_dates?.length ?? 0) > 1 ? "Sample collection dates" : "Sample collection date"}>
            {(upload.sample_collection_dates?.length ? upload.sample_collection_dates : [upload.sample_collection_date])
              .map((d) => formatDateFromDb(d))
              .join(", ")}
          </Item>
          <Item label="Instrument">{isInstrumentId(upload.instrument) ? INSTRUMENT_PROFILES[upload.instrument].label : upload.instrument ?? "—"}</Item>
          <Item label="Submitted">{formatDateTimeIso(upload.submitted_at)}</Item>
          <Item label="Warnings acknowledged">{upload.warning_acknowledged ? "Yes" : "No"}</Item>
          <Item label="Approved">{formatDateTimeIso(upload.approved_at)}</Item>
        </dl>
        {upload.upload_status === "draft" ? (
          <p className="mt-3 text-sm text-muted-foreground">
            This upload was started but not submitted (the files did not pass validation or the upload was interrupted).
            Delete it and upload the run again.
          </p>
        ) : null}
        {upload.rejection_reason ? (
          <p className="mt-3 rounded-md border p-3 text-sm">Rejected: {upload.rejection_reason}</p>
        ) : null}
        {upload.compile_notes ? (
          <p className="mt-3 rounded-md border p-3 text-sm whitespace-pre-wrap">Compilation: {upload.compile_notes}</p>
        ) : null}
        {upload.notes ? <p className="mt-3 text-sm whitespace-pre-wrap">Notes: {upload.notes}</p> : null}
      </Panel>

      <Panel title="Files">
        {upload.files.length === 0 ? (
          <p className="text-sm text-muted-foreground">No files were recorded for this upload.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {upload.files.map((f) => (
              <li key={f.id} className="break-all">
                <span className="text-muted-foreground">{FILE_LABELS[f.file_kind] ?? f.file_kind}:</span> {f.original_filename}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {upload.splits.length > 0 ? (
        <Panel
          title="Split by sample"
          description={`The run was split into one file per sample (${upload.split_mode === "by_date" ? "by collection date" : "by site"}), as in the AMR portal.`}
        >
          <ul className="space-y-1 text-sm">
            {upload.splits.map((s) => (
              <li key={s.id} className="break-all">
                <span className="font-mono">{s.display_filename}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {upload.split_mode === "by_date" ? `collected ${formatDateFromDb(s.collection_date)}` : `site ${s.split_key}`}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <section id="validation" className="scroll-mt-24">
        <Panel
          title="Validation results"
          description={
            upload.latestRun
              ? `Checked ${formatDateTimeIso(upload.latestRun.created_at)}: ${upload.latestRun.passed ? "passed" : "failed"}, ${upload.latestRun.error_count} errors, ${upload.latestRun.warning_count} warnings.`
              : undefined
          }
        >
          {!upload.latestRun ? (
            <p className="text-sm text-muted-foreground">No validation run recorded yet.</p>
          ) : errors.length + warnings.length === 0 ? (
            <p className="text-sm">No errors or warnings.</p>
          ) : (
            <div className="space-y-3 text-sm">
              {errors.length > 0 ? <IssueList items={errors} className="text-destructive" /> : null}
              {warnings.length > 0 ? <IssueList items={warnings} /> : null}
            </div>
          )}
          {details.length > 0 ? (
            <ul className="mt-3 list-inside list-disc text-xs text-muted-foreground">
              {details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          ) : null}
        </Panel>
      </section>
    </div>
  )
}
