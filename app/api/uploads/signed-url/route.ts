import { NextResponse } from "next/server"
import { forbiddenFromAuth, jsonError, logUploadStage, readJson } from "@/lib/upload/api"
import { getCentreUploadContext } from "@/lib/upload/centre-context"
import { UPLOAD_BUCKET, buildUploadPath, type UploadFileKind } from "@/lib/upload/path"

type SignedUrlBody = { projectCode?: string; uploadId?: string; filename?: string; fileKind?: UploadFileKind }

/**
 * A signed URL for the browser to put one file straight into storage, after
 * checking the batch is the user's own draft. From vrdl-next-platform
 * app/api/uploads/signed-url.
 */
export async function POST(request: Request) {
  const body = await readJson<SignedUrlBody>(request)
  if (!body) return jsonError(400, { message: "Invalid JSON body", code: "INVALID_BODY", stage: "signed_url" })

  const auth = await getCentreUploadContext(body.projectCode, { requireActiveCentre: true })
  if (!auth.ok) return forbiddenFromAuth(auth.reason, "signed_url")
  const { context } = auth

  if (body.fileKind !== "results" && body.fileKind !== "runfile") {
    return jsonError(400, { message: "fileKind must be results or runfile", code: "INVALID_FILE_KIND", stage: "signed_url" })
  }
  if (!body.uploadId || !body.filename) {
    return jsonError(400, { message: "uploadId and filename are required", code: "MISSING_FIELD", stage: "signed_url" })
  }

  const { data: batch } = await context.supabase
    .from("upload_batches")
    .select("id")
    .eq("id", body.uploadId)
    .eq("project_id", context.project.id)
    .eq("centre_id", context.centre.id)
    .eq("uploaded_by", context.userId)
    .eq("upload_status", "draft")
    .maybeSingle()
  if (!batch) {
    logUploadStage("signed_url", { level: "error", code: "BATCH_NOT_FOUND", uploadId: body.uploadId })
    return jsonError(404, { message: "Upload batch not found", code: "BATCH_NOT_FOUND", stage: "signed_url" })
  }

  const storagePath = buildUploadPath(context.project.code, context.centre.id, batch.id, body.fileKind, body.filename)
  const { data, error } = await context.supabase.storage.from(UPLOAD_BUCKET).createSignedUploadUrl(storagePath)
  if (error || !data) {
    logUploadStage("signed_url", { level: "error", code: "SIGNED_URL_FAILED", uploadId: batch.id, storageMessage: error?.message })
    return jsonError(500, { message: error?.message ?? "Could not generate signed URL", code: "SIGNED_URL_FAILED", stage: "signed_url" })
  }

  logUploadStage("signed_url", { projectCode: context.project.code, uploadId: batch.id, fileKind: body.fileKind })
  return NextResponse.json({ bucket: UPLOAD_BUCKET, storagePath, token: data.token, path: data.path })
}
