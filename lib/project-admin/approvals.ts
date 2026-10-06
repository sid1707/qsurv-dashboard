import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * The project's upload approval queue, from vrdl-next-platform
 * lib/dashboard/admin-queue.ts: submitted, active uploads that passed
 * validation and are neither approved nor rejected. Oldest first, so uploads
 * are reviewed in the order they arrived.
 */

type Embedded<T> = T | T[] | null
const many = <T>(v: Embedded<T>): T[] => (v == null ? [] : Array.isArray(v) ? v : [v])

export type QueueIssue = { severity: "error" | "warning"; issue_code: string; message: string }

export type QueueSplitFile = { id: string; display_filename: string; collection_date: string | null; split_key: string }

export type ApprovalQueueItem = {
  id: string
  submittedAt: string | null
  centreId: string
  centreCode: string | null
  centreName: string
  uploaderName: string | null
  instrument: string | null
  collectionDates: string[]
  resultsFilename: string | null
  runFilename: string | null
  splitMode: string
  logicalFileCount: number
  splitFiles: QueueSplitFile[]
  notes: string | null
  warningAcknowledged: boolean
  warnings: QueueIssue[]
}

type Row = {
  id: string
  submitted_at: string | null
  centre_id: string
  instrument: string | null
  sample_collection_date: string | null
  sample_collection_dates: string[] | null
  split_mode: string
  logical_file_count: number
  notes: string | null
  warning_acknowledged: boolean
  centres: Embedded<{ name: string; code: string | null }>
  uploader: Embedded<{ full_name: string }>
  upload_files: Embedded<{ file_kind: string; original_filename: string }>
  upload_split_artifacts: Embedded<QueueSplitFile & { split_index: number }>
  validation_runs: Embedded<{ id: string; passed: boolean; created_at: string }>
}

const QUEUE_SELECT =
  "id, submitted_at, centre_id, instrument, sample_collection_date, sample_collection_dates, split_mode, logical_file_count, notes, warning_acknowledged, centres(name, code), uploader:profiles!upload_batches_uploaded_by_fkey(full_name), upload_files(file_kind, original_filename), upload_split_artifacts(id, split_index, display_filename, collection_date, split_key), validation_runs(id, passed, created_at)"

export async function listApprovalQueue(supabase: SupabaseClient, projectId: string, limit = 100): Promise<ApprovalQueueItem[]> {
  const { data, error } = await supabase
    .from("upload_batches")
    .select(QUEUE_SELECT)
    .eq("project_id", projectId)
    .eq("approval_status", "pending")
    .eq("is_active", true)
    .eq("upload_status", "uploaded")
    .eq("processing_status", "completed")
    .order("submitted_at", { ascending: true })
    .limit(limit)
  if (error) throw new Error(`Could not load the approval queue: ${error.message}`)

  const items = ((data ?? []) as Row[]).flatMap((b) => {
    const run = [...many(b.validation_runs)].sort((x, y) => (x.created_at < y.created_at ? 1 : -1))[0]
    if (!run?.passed) return []
    const centre = many(b.centres)[0]
    const files = many(b.upload_files)
    const dates = b.sample_collection_dates?.length ? b.sample_collection_dates : b.sample_collection_date ? [b.sample_collection_date] : []
    return [
      {
        runId: run.id,
        item: {
          id: b.id,
          submittedAt: b.submitted_at,
          centreId: b.centre_id,
          centreCode: centre?.code ?? null,
          centreName: centre?.name ?? "Unknown centre",
          uploaderName: many(b.uploader)[0]?.full_name || null,
          instrument: b.instrument,
          collectionDates: dates.map((d) => d.slice(0, 10)),
          resultsFilename: files.find((f) => f.file_kind === "results")?.original_filename ?? null,
          runFilename: files.find((f) => f.file_kind === "runfile")?.original_filename ?? null,
          splitMode: b.split_mode,
          logicalFileCount: b.logical_file_count,
          splitFiles: many(b.upload_split_artifacts)
            .sort((x, y) => x.split_index - y.split_index)
            .map(({ id, display_filename, collection_date, split_key }) => ({ id, display_filename, collection_date, split_key })),
          notes: b.notes,
          warningAcknowledged: b.warning_acknowledged,
          warnings: [] as QueueIssue[],
        },
      },
    ]
  })
  if (items.length === 0) return []

  // Passed runs only carry warnings; errors would have blocked the submit.
  const { data: issues, error: issueError } = await supabase
    .from("validation_issues")
    .select("validation_run_id, severity, issue_code, message")
    .in(
      "validation_run_id",
      items.map((i) => i.runId)
    )
    .neq("severity", "detail")
    .order("id")
  if (issueError) throw new Error(`Could not load validation messages: ${issueError.message}`)

  const byRun = new Map(items.map((i) => [i.runId, i.item]))
  for (const issue of (issues ?? []) as (QueueIssue & { validation_run_id: string })[]) {
    byRun.get(issue.validation_run_id)?.warnings.push({ severity: issue.severity, issue_code: issue.issue_code, message: issue.message })
  }
  return items.map((i) => i.item)
}
