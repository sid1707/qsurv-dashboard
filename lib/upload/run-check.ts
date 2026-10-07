import { expandLayout, type PlateComposition } from "@/lib/plate/layout"
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
  /** Samples per plate and how they differ, chosen on the upload. */
  composition: PlateComposition
  runFilename: string | null
  centre: CentreFileIdentity | null
  now?: Date
}

export type RunCheckResult = ValidationResult & { artifacts: SplitArtifact[]; splitMode: SplitMode }

/**
 * The full check for one upload: the project's layout widened to the upload's
 * plate composition, then the results export through the split router
 * and engine, plus the run file (runfile_required rule). Used by the validate
 * route and again on submit against the stored file, so the browser's result
 * is never trusted.
 */
export function checkRun(setup: ValidationSetup, input: RunCheckInput): RunCheckResult {
  const runIssues = setup.rules.runfile_required?.enabled
    ? validateRunfile(input.filename, input.runFilename, input.instrument, input.centre, input.sampleDates)
    : []
  const plate = expandLayout(setup.layout, input.composition)
  if (!plate) {
    return {
      passed: false,
      issues: [
        {
          severity: "error",
          rowNumber: null,
          fieldName: "plateComposition",
          errorCode: "PLATE_COMPOSITION_DOES_NOT_FIT",
          errorMessage: `${input.composition.samples} samples do not fit on one plate with this project's layout. Choose fewer samples per plate.`,
        },
      ],
      details: setup.notes,
      artifacts: [],
      splitMode: "none",
    }
  }
  const split = runSplitValidation({
    filename: input.filename,
    csvText: input.csvText,
    kit: setup.kit,
    layout: plate.layout,
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
