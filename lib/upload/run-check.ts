import type { InstrumentId } from "@/lib/qpcr/instruments"
import { prioritizeValidationIssues } from "@/lib/validation/engine"
import { validateRunfile, type CentreFileIdentity } from "@/lib/validation/filename"
import type { ValidationSetup } from "@/lib/validation/setup"
import { runSplitValidation } from "@/lib/validation/split/router"
import type { SplitArtifact, SplitMode } from "@/lib/validation/split/types"
import type { ValidationResult } from "@/lib/validation/types"

export type RunCheckInput = {
  filename: string
  csvText: string
  instrument: InstrumentId
  /** ISO collection dates: one per sample on multi-date plates, otherwise one. */
  sampleDates: string[]
  runFilename: string | null
  centre: CentreFileIdentity | null
  now?: Date
}

export type RunCheckResult = ValidationResult & { artifacts: SplitArtifact[]; splitMode: SplitMode }

/**
 * The full check for one upload: the results export through the split router
 * and engine, plus the run file (runfile_required rule). Used by the validate
 * route and again on submit against the stored file, so the browser's result
 * is never trusted.
 */
export function checkRun(setup: ValidationSetup, input: RunCheckInput): RunCheckResult {
  const runIssues = setup.rules.runfile_required?.enabled
    ? validateRunfile(input.filename, input.runFilename, input.instrument, input.centre, input.sampleDates)
    : []
  const split = runSplitValidation({
    filename: input.filename,
    csvText: input.csvText,
    kit: setup.kit,
    layout: setup.layout,
    rules: setup.rules,
    instrument: input.instrument,
    centre: input.centre,
    sampleDates: input.sampleDates,
    now: input.now,
  })

  if (!split.ok) {
    return {
      passed: false,
      issues: prioritizeValidationIssues([...runIssues, ...split.issues]),
      details: setup.notes,
      artifacts: [],
      splitMode: "none",
    }
  }
  const issues = prioritizeValidationIssues([...runIssues, ...split.aggregated.issues])
  return {
    passed: !issues.some((i) => i.severity === "error"),
    issues,
    details: [...setup.notes, ...split.aggregated.details],
    artifacts: split.artifacts,
    splitMode: split.splitMode,
  }
}

export function splitValidationIssues(issues: ValidationResult["issues"]) {
  return {
    errors: issues.filter((i) => i.severity === "error"),
    warnings: issues.filter((i) => i.severity === "warning"),
  }
}
