/** One plain status for a centre user, from the batch's upload, processing and approval columns. */

export type UploadStatusTone = "neutral" | "progress" | "waiting" | "good" | "bad"

export type UploadBatchStatus = {
  upload_status: string
  processing_status: string | null
  approval_status: string
}

export function uploadStatus(batch: UploadBatchStatus): { label: string; tone: UploadStatusTone } {
  if (batch.approval_status === "rejected" || batch.upload_status === "rejected") return { label: "Rejected", tone: "bad" }
  if (batch.approval_status === "approved" || batch.upload_status === "approved") {
    return batch.upload_status === "compiled" ? { label: "Compiled", tone: "good" } : { label: "Approved", tone: "good" }
  }
  if (batch.upload_status === "draft") return { label: "Not submitted", tone: "neutral" }
  if (batch.processing_status === "failed") return { label: "Processing failed", tone: "bad" }
  if (["queued", "parsing", "validating", "compiling"].includes(batch.upload_status)) return { label: "Processing", tone: "progress" }
  return { label: "Awaiting approval", tone: "waiting" }
}

/** Centre users can delete their own uploads until the project admin approves or rejects them. */
export function canDeleteUpload(batch: UploadBatchStatus) {
  return batch.approval_status === "pending" && batch.upload_status !== "approved" && batch.upload_status !== "rejected"
}
