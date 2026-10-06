import { NextResponse } from "next/server"
import { forbiddenFromAuth, jsonError, logUploadStage, readJson } from "@/lib/upload/api"
import { centreIdentity, getCentreUploadContext } from "@/lib/upload/centre-context"
import { FINALIZE_HTTP_STATUS, finalizeUploadSubmit, type UploadFileRef } from "@/lib/upload/finalize"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import { loadValidationSetup } from "@/lib/validation/setup"

type SubmitBody = {
  projectCode?: string
  uploadId?: string
  warningAcknowledged?: boolean
  results?: UploadFileRef
  runfile?: UploadFileRef | null
}

const validRef = (ref: UploadFileRef | null | undefined): ref is UploadFileRef =>
  Boolean(ref?.bucket && ref.storagePath && ref.originalFilename)

/** Re-validates the stored export and records the result. From vrdl-next-platform app/api/uploads/submit. */
export async function POST(request: Request) {
  const body = await readJson<SubmitBody>(request)
  if (!body) return jsonError(400, { message: "Invalid JSON body", code: "INVALID_BODY", stage: "submit" })

  const auth = await getCentreUploadContext(body.projectCode, { requireActiveCentre: true })
  if (!auth.ok) return forbiddenFromAuth(auth.reason, "submit")
  const { context } = auth

  if (!body.uploadId || !validRef(body.results) || (body.runfile && !validRef(body.runfile))) {
    return jsonError(400, { message: "uploadId and file descriptors are required", code: "MISSING_FIELD", stage: "submit" })
  }

  const finalized = await finalizeUploadSubmit({
    supabase: context.supabase,
    service: createServiceRoleClient(),
    project: context.project,
    centreId: context.centre.id,
    centre: centreIdentity(context.centre),
    userId: context.userId,
    setup: await loadValidationSetup(context.supabase, context.project),
    uploadId: body.uploadId,
    results: body.results,
    runfile: body.runfile ?? null,
    warningAcknowledged: Boolean(body.warningAcknowledged),
  })

  if (!finalized.ok) {
    const status = FINALIZE_HTTP_STATUS[finalized.code]
    logUploadStage("submit", { level: "error", code: finalized.code, projectCode: context.project.code, uploadId: body.uploadId })
    return jsonError(status, {
      message: finalized.message,
      code: finalized.code,
      stage: "submit",
      issues: finalized.issues,
      details: finalized.details,
    })
  }

  logUploadStage("submit", { projectCode: context.project.code, uploadId: body.uploadId, status: "uploaded" })
  return NextResponse.json({ uploadId: body.uploadId, status: "uploaded", processingStatus: "completed" })
}
