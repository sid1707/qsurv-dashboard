"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { inputClass } from "@/components/project-admin/form"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { formatDateFromDb, formatDateTimeIso } from "@/lib/format"
import type { ApprovalQueueItem } from "@/lib/project-admin/approvals"
import { INSTRUMENT_PROFILES, isInstrumentId } from "@/lib/qpcr/instruments"

type ApproveResponse = { rowsWritten: number; compileSkipped: boolean; compiled: boolean; alreadyApproved: boolean }

/** From vrdl-next-platform components/admin/approval-queue.tsx, scoped to one project. */
async function postReview(code: string, uploadId: string, action: "approve" | "reject", body?: unknown) {
  const res = await fetch(`/api/projects/${encodeURIComponent(code)}/uploads/${uploadId}/${action}`, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.message ?? `${action === "approve" ? "Approve" : "Reject"} failed`)
  return json
}

function approvedMessage(r: ApproveResponse) {
  if (r.alreadyApproved) return "This upload was already approved."
  if (!r.compiled) return "Upload approved."
  if (r.compileSkipped) return "Upload approved but not compiled (0 rows). The centre sees the reason on its upload."
  return `Upload approved (${r.rowsWritten} row${r.rowsWritten === 1 ? "" : "s"} compiled).`
}

export function ApprovalQueue({ code, items, compiles }: { code: string; items: ApprovalQueueItem[]; compiles: boolean }) {
  const router = useRouter()
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [approvingAll, setApprovingAll] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [rejecting, setRejecting] = useState<ApprovalQueueItem | null>(null)
  const [reason, setReason] = useState("")

  const anyBusy = approvingAll || busyId !== null

  async function handleApprove(id: string) {
    setBusyId(id)
    setMessage(null)
    try {
      setMessage({ text: approvedMessage(await postReview(code, id, "approve")), error: false })
      router.refresh()
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Approve failed", error: true })
    } finally {
      setBusyId(null)
    }
  }

  async function handleApproveAll() {
    setApprovingAll(true)
    setMessage(null)
    let ok = 0
    const errors: string[] = []
    for (const [i, item] of items.entries()) {
      setBusyId(item.id)
      setMessage({ text: `Approving ${i + 1} of ${items.length}: ${item.centreName}…`, error: false })
      try {
        await postReview(code, item.id, "approve")
        ok += 1
      } catch (e) {
        errors.push(`${item.resultsFilename ?? item.centreName}: ${e instanceof Error ? e.message : "Approve failed"}`)
      }
    }
    setBusyId(null)
    setApprovingAll(false)
    const parts = [`Approved ${ok} of ${items.length}.`]
    if (errors.length > 0) parts.push(`${errors.length} failed.`, errors.slice(0, 5).join(" · "))
    setMessage({ text: parts.join(" "), error: errors.length > 0 })
    router.refresh()
  }

  async function handleReject() {
    const item = rejecting
    if (!item || !reason.trim()) return
    setRejecting(null)
    setBusyId(item.id)
    setMessage(null)
    try {
      await postReview(code, item.id, "reject", { reason: reason.trim() })
      setMessage({ text: "Upload rejected.", error: false })
      setReason("")
      router.refresh()
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Reject failed", error: true })
    } finally {
      setBusyId(null)
    }
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {items.length === 0
            ? "No uploads awaiting approval."
            : `${items.length} upload${items.length === 1 ? "" : "s"} awaiting approval`}
        </p>
        {items.length > 0 ? (
          <AlertDialog>
            <AlertDialogTrigger render={<Button type="button" disabled={anyBusy} />}>
              {approvingAll ? "Approving all…" : "Approve all"}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Approve all {items.length} upload{items.length === 1 ? "" : "s"}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {compiles
                    ? "Each upload is compiled into the project's data the same way as Approve."
                    : "Each upload is approved the same way as Approve."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void handleApproveAll()}>Approve all</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>

      {message ? (
        <p role="status" className={message.error ? "mb-2 text-sm text-destructive" : "mb-2 text-sm text-muted-foreground"}>
          {message.text}
        </p>
      ) : null}

      <ul className="space-y-3">
        {items.map((item) => {
          const files =
            item.splitFiles.length > 0
              ? item.splitFiles
              : [{ id: "raw", display_filename: item.resultsFilename ?? "Results file", collection_date: item.collectionDates[0] ?? null, split_key: "" }]
          return (
            <li key={item.id} className="rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {item.centreCode ? `${item.centreCode} — ` : ""}
                    {item.centreName}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {item.logicalFileCount > 1 ? `${item.logicalFileCount} samples (split upload)` : "1 sample"}
                    {" · "}
                    {isInstrumentId(item.instrument) ? INSTRUMENT_PROFILES[item.instrument].label : item.instrument ?? "Instrument —"}
                    {" · "}Submitted {formatDateTimeIso(item.submittedAt)}
                    {item.uploaderName ? ` by ${item.uploaderName}` : ""}
                  </p>
                  {item.splitFiles.length > 0 && item.resultsFilename ? (
                    <p className="text-xs break-all text-muted-foreground">Source plate: {item.resultsFilename}</p>
                  ) : null}
                  {item.runFilename ? <p className="text-xs break-all text-muted-foreground">Run file: {item.runFilename}</p> : null}

                  {item.notes ? (
                    <div className="mt-2 rounded-md border bg-muted/40 p-2 text-sm">
                      <p className="text-xs font-medium text-muted-foreground">Notes</p>
                      <p className="mt-1 whitespace-pre-wrap">{item.notes}</p>
                    </div>
                  ) : null}

                  <ul className="mt-3 space-y-1 rounded-md border bg-muted/30 p-2">
                    {files.map((f) => (
                      <li key={f.id} className="text-sm">
                        <p className="font-medium break-all">{f.display_filename}</p>
                        <p className="text-xs text-muted-foreground">
                          Collection: {formatDateFromDb(f.collection_date)}
                        </p>
                      </li>
                    ))}
                  </ul>

                  {item.warnings.length > 0 ? (
                    <>
                      <button
                        type="button"
                        className="mt-2 text-xs text-primary underline"
                        aria-expanded={expanded.has(item.id)}
                        onClick={() => toggle(item.id)}
                      >
                        {expanded.has(item.id) ? "Hide" : "View"} {item.warnings.length} validation warning
                        {item.warnings.length === 1 ? "" : "s"}
                        {item.warningAcknowledged ? " (acknowledged by the centre)" : ""}
                      </button>
                      {expanded.has(item.id) ? (
                        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-amber-700 dark:text-amber-400">
                          {item.warnings.map((w, i) => (
                            <li key={i} className="whitespace-pre-wrap">
                              {w.message}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button type="button" size="sm" disabled={anyBusy} onClick={() => void handleApprove(item.id)}>
                    {busyId === item.id && !approvingAll ? "Approving…" : "Approve"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={anyBusy}
                    onClick={() => {
                      setReason("")
                      setRejecting(item)
                    }}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <AlertDialog open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject this upload?</AlertDialogTitle>
            <AlertDialogDescription>
              {rejecting?.resultsFilename ?? "The upload"} from {rejecting?.centreName}. The centre sees your reason on its upload.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label htmlFor="reject-reason" className="text-sm font-medium">
            Reason (required)
          </label>
          <textarea
            id="reject-reason"
            rows={3}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={inputClass}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={!reason.trim()} onClick={() => void handleReject()}>
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
