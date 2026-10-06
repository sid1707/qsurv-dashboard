"use client"

import { useActionState, useState } from "react"
import { approveRequestAction, rejectRequestAction } from "@/app/(app)/super-admin/actions"
import { Button } from "@/components/ui/button"
import type { ReviewState } from "@/lib/super-admin/requests"

const IDLE: ReviewState = { status: "idle" }
const textareaClass =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"

export function ReviewActions({
  requestId,
  projectCode,
  centreCount,
}: {
  requestId: string
  projectCode: string | null
  centreCount: number
}) {
  const [mode, setMode] = useState<"approve" | "reject" | null>(null)
  const [approveState, approve, approving] = useActionState(approveRequestAction, IDLE)
  const [rejectState, reject, rejecting] = useActionState(rejectRequestAction, IDLE)
  const busy = approving || rejecting

  return (
    <div className="rounded-lg border bg-card p-5">
      <h2 className="font-semibold">Decision</h2>
      {mode === null ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <Button type="button" onClick={() => setMode("approve")}>
            Approve
          </Button>
          <Button type="button" variant="outline" onClick={() => setMode("reject")}>
            Reject
          </Button>
        </div>
      ) : null}

      {mode === "approve" ? (
        <form action={approve} className="mt-4 space-y-3">
          <input type="hidden" name="requestId" value={requestId} />
          <p className="text-sm text-muted-foreground">
            This creates project <span className="font-mono">{projectCode ?? "—"}</span> with{" "}
            {centreCount} centre{centreCount === 1 ? "" : "s"} from the form, makes the requester its
            project admin, turns on the chosen analysis features and unblocks their login.
          </p>
          <div className="space-y-1.5">
            <label htmlFor="note" className="text-sm font-medium">
              Note <span className="font-normal text-muted-foreground">(optional, kept with the request)</span>
            </label>
            <textarea id="note" name="note" rows={2} maxLength={2000} className={textareaClass} />
          </div>
          {approveState.status === "error" ? (
            <p role="alert" className="text-sm text-destructive">
              {approveState.message}
            </p>
          ) : null}
          <div className="flex gap-3">
            <Button type="submit" disabled={busy}>
              {approving ? "Approving..." : "Confirm approval"}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setMode(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {mode === "reject" ? (
        <form action={reject} className="mt-4 space-y-3">
          <input type="hidden" name="requestId" value={requestId} />
          <div className="space-y-1.5">
            <label htmlFor="reason" className="text-sm font-medium">
              Reason for rejection
            </label>
            <textarea
              id="reason"
              name="reason"
              rows={3}
              required
              maxLength={2000}
              aria-describedby="reason-hint"
              className={textareaClass}
            />
            <p id="reason-hint" className="text-xs text-muted-foreground">
              Required. The admin account stays blocked.
            </p>
          </div>
          {rejectState.status === "error" ? (
            <p role="alert" className="text-sm text-destructive">
              {rejectState.message}
            </p>
          ) : null}
          <div className="flex gap-3">
            <Button type="submit" variant="destructive" disabled={busy}>
              {rejecting ? "Rejecting..." : "Confirm rejection"}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setMode(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
