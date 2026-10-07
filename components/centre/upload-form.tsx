"use client"

// Adapted from vrdl-next-platform app/(vrdl)/uploads/upload-form.tsx. The AMR
// form's VRDL fields are replaced by the project's instrument(s); the kit and
// one-sample plate layout come from the project, and the plate composition
// (samples per plate, multiple dates or sites) is chosen here as in the AMR form.

import { type FormEvent, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { UploadWarningDialog } from "@/components/centre/upload-warning-dialog"
import { ValidationResults, isRunFileIssue } from "@/components/centre/validation-results"
import { Field, inputClass, textareaClass } from "@/components/project-admin/form"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { DmyDateInput } from "@/components/ui/dmy-date-input"
import { LayoutPreview } from "@/components/plate/layout-preview"
import { exampleFileName } from "@/lib/centres/file-name"
import type { KitTube } from "@/lib/kits/public"
import {
  MULTI_SAMPLE_MODES,
  SAMPLE_IDENTIFIER_COLUMNS,
  SINGLE_SAMPLE,
  compositionDateCount,
  expandLayout,
  type PlateComposition,
  type PlateLayout,
} from "@/lib/plate/layout"
import type { InstrumentId } from "@/lib/qpcr/instruments"
import { buildValidateFormData, runUploadPipeline, validateResultsOnly } from "@/lib/upload/client"
import { NOTES_MAX_LENGTH, type UploadFormMetadata, type UploadPipelineStage } from "@/lib/upload/client-types"
import { splitValidationIssues } from "@/lib/upload/run-check"
import type { ValidationIssue } from "@/lib/validation/types"
import { cn } from "@/lib/utils"

const STAGE_LABELS: Record<UploadPipelineStage, string> = {
  validating: "Validating the results file…",
  starting_batch: "Creating the upload…",
  uploading_results: "Uploading the results file…",
  uploading_runfile: "Uploading the run file…",
  submitting: "Checking and saving…",
  done: "Upload complete",
}

export type InstrumentOption = { id: InstrumentId; label: string; runfileExtensions: string[]; exportHint: string }

const chooseFileButtonClass =
  "inline-flex h-8 items-center rounded-lg border bg-muted px-3 text-sm font-medium hover:bg-muted/70"

/** The project's one-sample plate layout, which each upload's plate composition builds on. */
export type PlatePlan = {
  tubes: KitTube[]
  layout: PlateLayout
  /** Most samples that fit on one plate with this layout. */
  maxSamples: number
}

/** The plate compositions offered, as in the AMR portal's dropdown. */
function compositionOptions(maxSamples: number) {
  const options: { value: string; label: string; composition: PlateComposition }[] = [
    { value: "1", label: "Single sample", composition: SINGLE_SAMPLE },
  ]
  for (let n = 2; n <= maxSamples; n++) {
    for (const m of MULTI_SAMPLE_MODES) {
      options.push({ value: `${n}:${m.value}`, label: `${n} samples, ${m.label.toLowerCase()}`, composition: { samples: n, mode: m.value } })
    }
  }
  return options
}

export function UploadForm({
  projectCode,
  instruments,
  uploadsHref,
  fileIdentity,
  plate,
}: {
  projectCode: string
  instruments: InstrumentOption[]
  uploadsHref: string
  /** The centre's ID and file code, for the example file name (e.g. C01_AIIMS_NewDelhi_DDMMYY.csv). */
  fileIdentity: { centreId: string; fileCode: string }
  plate: PlatePlan
}) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const resultsInputRef = useRef<HTMLInputElement>(null)
  const runInputRef = useRef<HTMLInputElement>(null)
  const [instrumentId, setInstrumentId] = useState<InstrumentId>(instruments[0].id)
  const [resultsName, setResultsName] = useState<string | null>(null)
  const [runName, setRunName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<UploadPipelineStage | null>(null)
  const [failure, setFailure] = useState<{ stage: UploadPipelineStage | null; message: string } | null>(null)
  const [errors, setErrors] = useState<ValidationIssue[]>([])
  const [warnings, setWarnings] = useState<ValidationIssue[]>([])
  const [details, setDetails] = useState<string[]>([])
  const [warningOpen, setWarningOpen] = useState(false)

  const [compositionValue, setCompositionValue] = useState("1")

  const instrument = instruments.find((i) => i.id === instrumentId) ?? instruments[0]
  const options = compositionOptions(plate.maxSamples)
  const composition = (options.find((o) => o.value === compositionValue) ?? options[0]).composition
  const dateCount = compositionDateCount(composition)
  const fileNameExample = exampleFileName(fileIdentity, dateCount)
  const expanded = composition.samples > 1 ? expandLayout(plate.layout, composition) : null

  function applyIssues(issues: ValidationIssue[], d: string[] = []) {
    const split = splitValidationIssues(issues)
    setErrors(split.errors)
    setWarnings(split.warnings)
    setDetails(d)
  }

  function readForm(form: HTMLFormElement):
    | { ok: true; results: File; run: File; metadata: UploadFormMetadata }
    | { ok: false; message: string } {
    // Commit a date typed but not yet blurred.
    form.querySelectorAll<HTMLInputElement>("input[data-dmy-date-text]").forEach((el) => el.dispatchEvent(new FocusEvent("blur", { bubbles: true })))
    const results = resultsInputRef.current?.files?.[0]
    const run = runInputRef.current?.files?.[0]
    const sampleCollectionDates = Array.from(
      form.querySelectorAll<HTMLInputElement>('input[name^="sampleCollectionDate"]:not([data-dmy-date-text])')
    ).map((el) => el.value.trim())
    const notes = form.querySelector<HTMLTextAreaElement>('textarea[name="notes"]')?.value.trim() || null
    if (!results) return { ok: false, message: "Choose the results export (.csv)." }
    if (!run) return { ok: false, message: `Choose the run file (${instrument.runfileExtensions.join(" or ")}).` }
    if (sampleCollectionDates.length !== dateCount || sampleCollectionDates.some((d) => !d)) {
      return {
        ok: false,
        message:
          dateCount === 1
            ? "Enter the sample collection date as DD/MM/YYYY."
            : `Enter all ${dateCount} collection dates as DD/MM/YYYY.`,
      }
    }
    if (new Set(sampleCollectionDates).size !== sampleCollectionDates.length) {
      return { ok: false, message: "Each sample on the plate needs a different collection date." }
    }
    return {
      ok: true,
      results,
      run,
      metadata: {
        projectCode,
        instrument: instrumentId,
        sampleCollectionDates,
        plateSamples: composition.samples,
        plateMode: composition.mode,
        notes,
      },
    }
  }

  async function upload(form: HTMLFormElement, warningAcknowledged: boolean) {
    const read = readForm(form)
    if (!read.ok) return setFailure({ stage: null, message: read.message })
    const result = await runUploadPipeline({
      resultsFile: read.results,
      runFile: read.run,
      metadata: read.metadata,
      warningAcknowledged,
      onStage: setStage,
    })
    if (!result.ok) {
      if (result.needsWarningAck) {
        if (result.failure.issues) applyIssues(result.failure.issues, result.failure.details)
        setWarningOpen(true)
      } else if (result.failure.issues?.length) {
        applyIssues(result.failure.issues, result.failure.details)
      } else {
        setFailure({ stage: result.failure.stage, message: result.failure.message })
      }
      return
    }
    setWarningOpen(false)
    router.push(`${uploadsHref}/${result.uploadId}`)
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    setBusy(true)
    setFailure(null)
    applyIssues([])
    try {
      const read = readForm(form)
      if (!read.ok) return setFailure({ stage: null, message: read.message })
      const validation = await validateResultsOnly(buildValidateFormData(read.results, read.run.name, read.metadata), setStage)
      if (!validation.ok) {
        if (validation.failure.issues?.length) applyIssues(validation.failure.issues, validation.failure.details)
        else setFailure({ stage: validation.failure.stage, message: validation.failure.message })
        return
      }
      applyIssues(validation.issues, validation.details)
      if (validation.hasWarnings) return setWarningOpen(true)
      await upload(form, false)
    } finally {
      setBusy(false)
      setStage(null)
    }
  }

  async function onConfirmWarnings() {
    if (!formRef.current) return
    setBusy(true)
    setFailure(null)
    try {
      await upload(formRef.current, true)
    } finally {
      setBusy(false)
      setStage(null)
    }
  }

  const runFileError = errors.find(isRunFileIssue)

  return (
    <div className="space-y-4">
      <UploadWarningDialog
        open={warningOpen}
        onOpenChange={setWarningOpen}
        warnings={warnings}
        details={details}
        isSubmitting={busy}
        onConfirm={onConfirmWarnings}
      />

      <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
        {failure ? (
          <Alert variant="destructive">
            <AlertTitle>{failure.stage ? `Failed while ${STAGE_LABELS[failure.stage].replace("…", "").toLowerCase()}` : "Upload not started"}</AlertTitle>
            <AlertDescription>{failure.message}</AlertDescription>
          </Alert>
        ) : busy && stage && stage !== "done" ? (
          <Alert>
            <AlertTitle>Upload in progress</AlertTitle>
            <AlertDescription>{STAGE_LABELS[stage]}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="upload-instrument" label="qPCR instrument">
            {instruments.length === 1 ? (
              <input id="upload-instrument" readOnly value={instrument.label} className={cn(inputClass, "bg-muted")} />
            ) : (
              <select
                id="upload-instrument"
                value={instrumentId}
                onChange={(e) => setInstrumentId(e.target.value as InstrumentId)}
                className={inputClass}
              >
                {instruments.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            id="upload-composition"
            label="Plate composition"
            hint={plate.maxSamples < 2 ? "(the project's layout leaves no room for a second sample)" : undefined}
          >
            <select
              id="upload-composition"
              value={compositionValue}
              disabled={busy}
              onChange={(e) => setCompositionValue(e.target.value)}
              className={inputClass}
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          {Array.from({ length: dateCount }, (_, i) => (
            <Field
              key={`${dateCount}-${i}`}
              id={`upload-date-${i}`}
              label={dateCount === 1 ? "Sample collection date" : `Collection date, sample ${i + 1}`}
            >
              <DmyDateInput id={`upload-date-${i}`} name={`sampleCollectionDate${i + 1}`} required />
            </Field>
          ))}
        </div>

        <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-xs">
          <p>
            Name both files <span className="font-mono">{fileNameExample}</span>
            {dateCount > 1 ? ", with one date per sample" : ""} (DDMMYYYY also works). The run file needs the same
            dates.
          </p>
          {composition.samples > 1 ? (
            <p>
              This plate carries {composition.samples} samples (
              {composition.mode === "sites" ? "multiple sites" : "multiple dates"}). The file is split into one file per
              sample, so each sample&apos;s identifier must be in the {SAMPLE_IDENTIFIER_COLUMNS.join(", ").replace(/, ([^,]*)$/, " or $1")}{" "}
              column:{" "}
              {composition.mode === "sites"
                ? "a site label (e.g. ETP, STP) that is the same in all of that sample's wells."
                : "the sample's collection date as DDMMYY or DDMMYYYY (e.g. 01102026, or WW_01102026)."}
            </p>
          ) : null}
          <p className="text-muted-foreground">{instrument.exportHint}</p>
        </div>

        {expanded ? (
          <details open className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Plate layout with {composition.samples} samples
            </summary>
            <div className="mt-3">
              <LayoutPreview tubes={plate.tubes} layout={expanded.layout} sampleWells={expanded.sampleWells} />
            </div>
          </details>
        ) : null}

        <div className="space-y-1 text-sm">
          <span className="font-medium">Results export (.csv)</span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={resultsInputRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              aria-label="Results export"
              onChange={(e) => setResultsName(e.target.files?.[0]?.name ?? null)}
            />
            <button type="button" className={chooseFileButtonClass} onClick={() => resultsInputRef.current?.click()}>
              Choose file
            </button>
            <span className={resultsName ? "break-all" : "text-muted-foreground"}>{resultsName ?? "No file chosen"}</span>
          </div>
        </div>

        <div
          className={cn(
            "space-y-1 rounded-md text-sm",
            runFileError && "border border-red-300 bg-red-50/50 p-2 dark:border-red-900 dark:bg-red-950/20"
          )}
        >
          <span className="font-medium">Run file ({instrument.runfileExtensions.join(", ")})</span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={runInputRef}
              type="file"
              accept={instrument.runfileExtensions.join(",")}
              className="sr-only"
              aria-label="Run file"
              onChange={(e) => {
                setRunName(e.target.files?.[0]?.name ?? null)
                setErrors((prev) => prev.filter((i) => !isRunFileIssue(i)))
              }}
            />
            <button type="button" className={chooseFileButtonClass} onClick={() => runInputRef.current?.click()}>
              Choose file
            </button>
            <span className={runName ? "break-all" : "text-muted-foreground"}>{runName ?? "No file chosen"}</span>
          </div>
        </div>

        <Field id="upload-notes" label="Notes" hint="(optional)">
          <textarea id="upload-notes" name="notes" rows={2} maxLength={NOTES_MAX_LENGTH} className={textareaClass} />
        </Field>

        <ValidationResults errors={errors} warnings={warnings} details={details} />

        <Button type="submit" disabled={busy}>
          {busy ? "Working…" : "Validate and upload"}
        </Button>
      </form>
    </div>
  )
}
