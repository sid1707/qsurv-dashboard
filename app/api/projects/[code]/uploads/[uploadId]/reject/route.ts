import { NextResponse } from "next/server"
import { rejectUpload, REVIEW_HTTP_STATUS } from "@/lib/compile/approve"
import { requireProjectAdminApi } from "@/lib/project-admin/api-auth"
import { createClient } from "@/lib/supabase/server"
import { logUploadStage, readJson } from "@/lib/upload/api"

/** Reject an upload with a reason the centre sees. From vrdl-next-platform app/api/admin/uploads/[uploadId]/reject. */
export async function POST(request: Request, { params }: { params: Promise<{ code: string; uploadId: string }> }) {
  const { code, uploadId } = await params
  const auth = await requireProjectAdminApi(code, "data_management")
  if (!auth.ok) return auth.response
  const { project } = auth.context

  const body = await readJson<{ reason?: unknown }>(request)
  if (!body) return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 })
  if (typeof body.reason !== "string" || !body.reason.trim()) {
    return NextResponse.json({ message: "Rejection reason is required" }, { status: 400 })
  }

  const result = await rejectUpload(await createClient(), project.id, uploadId, body.reason)
  if (!result.ok) {
    logUploadStage("reject", { level: "error", code: result.code, projectCode: project.code, uploadId })
    return NextResponse.json({ message: result.message, code: result.code }, { status: REVIEW_HTTP_STATUS[result.code] })
  }

  logUploadStage("reject", { projectCode: project.code, uploadId })
  return NextResponse.json({ uploadId, status: "rejected" })
}
