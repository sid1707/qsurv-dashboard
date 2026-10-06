import type { SupabaseClient } from "@supabase/supabase-js"
import { compileSampleCsv, type CompiledTarget } from "./engine"
import type { CompileSetup } from "./setup"

/**
 * From vrdl-next-platform lib/compile/compile-sources.ts: a multi-sample run is
 * compiled from the split files stored at submit (one per sample, with its own
 * collection date); any other run from the results export itself.
 */

export type CompileSource = {
  csvText: string
  collectionDate: string | null
  sourceFilename: string
  /** The sample's identifier or date key for a split file. */
  splitKey: string | null
}

type StoredFile = { file_kind: string; original_filename: string; storage_bucket: string; storage_path: string }
type StoredSplit = {
  split_index: number
  display_filename: string
  collection_date: string | null
  split_key: string
  storage_bucket: string
  storage_path: string
}

export type CompileBatch = {
  sample_collection_date: string | null
  split_mode: string
  upload_files: StoredFile[]
  upload_split_artifacts: StoredSplit[]
}

const ymd = (d: string | null) => (d ? d.slice(0, 10) : null)

async function download(supabase: SupabaseClient, bucket: string, path: string) {
  const { data, error } = await supabase.storage.from(bucket).download(path)
  if (error || !data) return { ok: false as const, message: error?.message ?? "file not found" }
  return { ok: true as const, text: await data.text() }
}

export async function loadCompileSources(
  supabase: SupabaseClient,
  batch: CompileBatch
): Promise<{ ok: true; sources: CompileSource[] } | { ok: false; message: string }> {
  const splits = [...batch.upload_split_artifacts].sort((a, b) => a.split_index - b.split_index)
  if (batch.split_mode !== "none" && splits.length > 0) {
    const sources: CompileSource[] = []
    for (const split of splits) {
      const file = await download(supabase, split.storage_bucket, split.storage_path)
      if (!file.ok) return { ok: false, message: `Could not read split file ${split.display_filename}: ${file.message}` }
      sources.push({
        csvText: file.text,
        collectionDate: ymd(split.collection_date) ?? ymd(batch.sample_collection_date),
        sourceFilename: split.display_filename,
        splitKey: split.split_key,
      })
    }
    return { ok: true, sources }
  }

  const results = batch.upload_files.find((f) => f.file_kind === "results")
  if (!results) return { ok: false, message: "The upload has no results file to compile." }
  const file = await download(supabase, results.storage_bucket, results.storage_path)
  if (!file.ok) return { ok: false, message: `Could not read ${results.original_filename}: ${file.message}` }
  return {
    ok: true,
    sources: [{ csvText: file.text, collectionDate: ymd(batch.sample_collection_date), sourceFilename: results.original_filename, splitKey: null }],
  }
}

/** One compiled_measurements row as approve_upload takes it; the batch scope is added in the database. */
export type MeasurementInput = {
  kit_target_id: string | null
  collection_date: string | null
  sample_label: string | null
  target_name: string
  cq_value: number | null
  cq_sd: number | null
  normalized_cq: number | null
  copy_number: number | null
  copy_number_sd: number | null
  metric_payload: Record<string, unknown>
}

export function toMeasurement(target: CompiledTarget, source: CompileSource, sampleLabel: string | null): MeasurementInput {
  const payload: Record<string, unknown> = {
    source_file: source.sourceFilename,
    control_type: target.controlType,
    readings: target.readings,
    replicates_used: target.replicatesUsed,
  }
  if (target.lowCtReplaced.length > 0) payload.low_ct_replaced = target.lowCtReplaced
  if (target.outliersRemoved > 0) {
    payload.outliers_removed = target.outliersRemoved
    payload.outlier_reason = target.outlierReason
  }
  return {
    kit_target_id: target.kitTargetId,
    collection_date: source.collectionDate,
    sample_label: sampleLabel ?? source.splitKey,
    target_name: target.targetName,
    cq_value: target.cq,
    cq_sd: target.cqSd,
    normalized_cq: target.normalizedCq,
    copy_number: target.copyNumber,
    copy_number_sd: target.copyNumberSd,
    metric_payload: payload,
  }
}

export type CompileUploadResult =
  | { ok: true; rows: MeasurementInput[]; samples: number; skipped: number; notes: string[] }
  | { ok: false; message: string }

/**
 * Compiles every sample of an upload. A sample whose endogenous control fails
 * is skipped with a note (as the AMR portal skips the file); any other failure
 * stops the approval so the admin can look at the file.
 */
export function compileUpload(sources: CompileSource[], setup: CompileSetup): CompileUploadResult {
  const rows: MeasurementInput[] = []
  const notes: string[] = []
  let skipped = 0
  for (const source of sources) {
    const result = compileSampleCsv(source.csvText, setup)
    if (!result.ok) {
      const message = sources.length > 1 ? `[${source.sourceFilename}] ${result.message}` : result.message
      if (!result.skip) return { ok: false, message: `Could not compile: ${message}` }
      skipped += 1
      notes.push(message)
      continue
    }
    rows.push(...result.targets.map((t) => toMeasurement(t, source, result.sampleLabel)))
  }
  return { ok: true, rows, samples: sources.length, skipped, notes }
}
