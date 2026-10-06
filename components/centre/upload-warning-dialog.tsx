"use client"

// Adapted from vrdl-next-platform app/(vrdl)/uploads/upload-warning-dialog.tsx.

import { useState } from "react"
import { IssueList } from "@/components/centre/validation-results"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { ENDOGENOUS_HIGH_CT_WARNING_DETAIL, isHighEndogenousCtWarningIssue } from "@/lib/validation/endogenous"
import { isLowCtWarningIssue } from "@/lib/validation/low-ct"
import type { ValidationIssue } from "@/lib/validation/types"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  warnings: ValidationIssue[]
  details?: string[]
  isSubmitting: boolean
  onConfirm: () => void
}

export function UploadWarningDialog({ open, onOpenChange, warnings, details, isSubmitting, onConfirm }: Props) {
  // Reset the run-file confirmation whenever the dialog opens with a new set of warnings.
  const [checkedFor, setCheckedFor] = useState<ValidationIssue[] | null>(null)
  const runFilesChecked = open && checkedFor === warnings

  const lowCt = warnings.filter(isLowCtWarningIssue)
  const highEndogenous = warnings.filter(isHighEndogenousCtWarningIssue)
  const other = warnings.filter((w) => !isLowCtWarningIssue(w) && !isHighEndogenousCtWarningIssue(w))
  const confirmDisabled = isSubmitting || (lowCt.length > 0 && !runFilesChecked)

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader className="text-left">
          <AlertDialogTitle>Confirm upload with warnings</AlertDialogTitle>
          <AlertDialogDescription>
            Your file passed validation but has warnings. Review them below. You can cancel to fix the file, or
            confirm to upload anyway.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="max-h-64 space-y-3 overflow-y-auto text-sm">
          {lowCt.length > 0 ? (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
              <p className="font-semibold text-red-900 dark:text-red-200">Priority: low Ct threshold</p>
              <p className="mt-1 text-xs text-red-800 dark:text-red-300">
                Very low Ct values may be caused by manual thresholding or instrument noise. Open the run file, switch
                to automatic Ct threshold or use Analyze to remove noise, then re-export before uploading if needed.
              </p>
              <IssueList items={lowCt} className="mt-2 text-red-800 dark:text-red-300" />
            </div>
          ) : null}
          {highEndogenous.length > 0 ? (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
              <p className="font-semibold text-red-900 dark:text-red-200">Priority: high endogenous control Ct</p>
              <p className="mt-1 text-xs text-red-800 dark:text-red-300">{ENDOGENOUS_HIGH_CT_WARNING_DETAIL}</p>
              <IssueList items={highEndogenous} className="mt-2 text-red-800 dark:text-red-300" />
            </div>
          ) : null}
          {other.length > 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
              <p className="font-medium text-amber-900 dark:text-amber-200">
                {other.length} warning{other.length === 1 ? "" : "s"}
              </p>
              <IssueList items={other} className="mt-2 text-amber-800 dark:text-amber-300" />
            </div>
          ) : null}
          {details && details.length > 0 ? (
            <div className="rounded-md border bg-muted/50 p-3">
              <p className="font-medium">Details</p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
                {details.map((d, idx) => (
                  <li key={idx}>{d}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {lowCt.length > 0 ? (
          <label className="flex cursor-pointer items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0"
              checked={runFilesChecked}
              onChange={(e) => setCheckedFor(e.target.checked ? warnings : null)}
              disabled={isSubmitting}
            />
            <span>I have checked the run file and all curves are okay to compile.</span>
          </label>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={confirmDisabled} onClick={onConfirm}>
            {isSubmitting ? "Uploading…" : "Confirm and upload"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
