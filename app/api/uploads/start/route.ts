import { NextResponse } from "next/server"
import { isInstrumentId } from "@/lib/qpcr/instruments"
import { forbiddenFromAuth, jsonError, logUploadStage, readJson } from "@/lib/upload/api"
import { getCentreUploadContext, parseSampleDates } from "@/lib/upload/centre-context"
import { loadValidationSetup } from "@/lib/validation/setup"
import { expectedDateCount } from "@/lib/validation/split/router"
import { NOTES_MAX_LENGTH } from "@/lib/upload/client-types"

type StartBody = {
  projectCode?: string
  instrument?: string
  /** One per sample on multi-date plates, otherwise one. */
  sampleCollectionDates?: string[]
  notes?: string | null
}

/** Creates the draft batch the files are stored under. From vrdl-next-platform app/api/uploads/start. */
export async function POST(request: Request) {
  const body = await readJson<StartBody>(request)
  if (!body) return jsonError(400, { message: "Invalid JSON body", code: "INVALID_BODY", stage: "start" })

  const auth = await getCentreUploadContext(body.projectCode, { requireActiveCentre: true })
  if (!auth.ok) return forbiddenFromAuth(auth.reason, "start")
  const { context } = auth

  if (!isInstrumentId(body.instrument) || !context.instruments.includes(body.instrument)) {
    return jsonError(400, { message: "Choose one of the project's instruments.", code: "INVALID_INSTRUMENT", stage: "start" })
  }
  const sampleDates = parseSampleDates(Array.isArray(body.sampleCollectionDates) ? body.sampleCollectionDates : [])
  if (!sampleDates) {
    return jsonError(400, { message: "Enter the sample collection date(s) as DD/MM/YYYY.", code: "MISSING_FIELD", stage: "start" })
  }
  const setup = await loadValidationSetup(context.supabase, context.project)
  const needed = expectedDateCount(setup.layout)
  if (sampleDates.length !== needed) {
    return jsonError(400, {
      message: needed === 1 ? "Enter one sample collection date." : `Enter ${needed} different collection dates, one per sample on the plate.`,
      code: "MISSING_PLATE_DATES",
      stage: "start",
    })
  }
  const notes = body.notes?.trim().slice(0, NOTES_MAX_LENGTH) || null

  // RLS checks the centre membership and that the centre is active.
  const { data, error } = await context.supabase
    .from("upload_batches")
    .insert({
      project_id: context.project.id,
      centre_id: context.centre.id,
      kit_id: context.project.kit_id,
      uploaded_by: context.userId,
      instrument: body.instrument,
      sample_collection_date: sampleDates[0],
      sample_collection_dates: sampleDates,
      notes,
      upload_status: "draft",
      approval_status: "pending",
    })
    .select("id, upload_status, created_at")
    .single()

  if (error || !data) {
    logUploadStage("start", { level: "error", code: "DB_INSERT_FAILED", projectCode: context.project.code, dbMessage: error?.message })
    return jsonError(500, { message: error?.message ?? "Unable to start upload", code: "DB_INSERT_FAILED", stage: "start" })
  }

  logUploadStage("start", { projectCode: context.project.code, centreId: context.centre.id, uploadId: data.id })
  return NextResponse.json({ uploadId: data.id, status: data.upload_status, createdAt: data.created_at })
}
