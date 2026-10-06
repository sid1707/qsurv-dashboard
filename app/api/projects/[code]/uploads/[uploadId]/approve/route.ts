import { NextResponse } from "next/server"
import { approveUpload, REVIEW_HTTP_STATUS } from "@/lib/compile/approve"
import { requireProjectAdminApi } from "@/lib/project-admin/api-auth"
import { createClient } from "@/lib/supabase/server"
import { logUploadStage } from "@/lib/upload/api"

/** Approve an upload and, when data compilation is on, compile it. From vrdl-next-platform app/api/admin/uploads/[uploadId]/approve. */
export async function POST(_: Request, { params }: { params: Promise<{ code: string; uploadId: string }> }) {
  const { code, uploadId } = await params
  const auth = await requireProjectAdminApi(code, "data_management")
  if (!auth.ok) return auth.response
  const { project } = auth.context

  const result = await approveUpload(await createClient(), project, uploadId)
  if (!result.ok) {
    logUploadStage("approve", { level: "error", code: result.code, projectCode: project.code, uploadId })
    return NextResponse.json({ message: result.message, code: result.code }, { status: REVIEW_HTTP_STATUS[result.code] })
  }

  logUploadStage("approve", { projectCode: project.code, uploadId, rowsWritten: result.rowsWritten })
  return NextResponse.json({
    uploadId,
    status: "approved",
    rowsWritten: result.rowsWritten,
    alreadyApproved: result.alreadyApproved,
    compileSkipped: result.compileSkipped,
    compileNotes: result.compileNotes,
    compiled: project.data_compilation,
  })
}
