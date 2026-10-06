/**
 * From vrdl-next-platform src/lib/split/router.ts (runSplitValidation) and
 * aggregate-validation.ts. The AMR plate composition dropdown becomes the
 * project's plate layout: one sample per plate (no split), several samples from
 * several dates (split by the date in each sample's identifier), or several
 * sites on one date (split by each sample's identifier).
 *
 * The flow is the AMR one: check the file name and dates, validate the whole
 * plate first (so replicate problems are not hidden by splitting), split
 * (failing closed, never falling back to the unsplit file), then validate each
 * split and aggregate the issues as "[split file] message".
 *
 * Samples are told apart only by their identifiers: a sample's replicates can
 * be in any of the plate's unknown wells. Each split must still hold the
 * layout's replicates for every target.
 */

import { samplesPerPlate, type PlateLayout } from "@/lib/plate/layout"
import type { InstrumentId } from "@/lib/qpcr/instruments"
import type { RuleSettings } from "@/lib/rules/catalog"
import { validateRunExport, prioritizeValidationIssues } from "@/lib/validation/engine"
import { parseUploadFilename, validateUploadFilename, type CentreFileIdentity } from "@/lib/validation/filename"
import type { ValidationKit } from "@/lib/validation/kit"
import type { ValidationIssue, ValidationResult } from "@/lib/validation/types"
import { checkSampleIdentifiers } from "./identifiers"
import { splitByCollectionDates } from "./split-by-dates"
import { discoverIdentifierGroupCount, splitByIdentifier } from "./split-by-identifier"
import { splitIssue, type AggregatedSplitValidation, type SplitArtifact, type SplitMode } from "./types"

export type SplitValidationInput = {
  filename: string
  csvText: string
  kit: ValidationKit
  layout: PlateLayout
  rules: RuleSettings
  instrument: InstrumentId
  centre: CentreFileIdentity | null
  /** ISO dates: one per sample on multi-date plates, otherwise one. */
  sampleDates: string[]
  now?: Date
}

export type SplitValidationResult =
  | { ok: false; issues: ValidationIssue[] }
  | { ok: true; aggregated: AggregatedSplitValidation; artifacts: SplitArtifact[]; splitMode: SplitMode }

export function resolveSplitStrategy(layout: PlateLayout): SplitMode {
  if (samplesPerPlate(layout.counts) < 2) return "none"
  return layout.multiSample?.mode === "sites" ? "by_identifier" : "by_date"
}

/** How many collection dates an upload needs for this layout. */
export function expectedDateCount(layout: PlateLayout) {
  return resolveSplitStrategy(layout) === "by_date" ? samplesPerPlate(layout.counts) : 1
}

const display = (iso: string) => iso.split("-").reverse().join("/")

function splitFailure(err: unknown): ValidationIssue {
  // The AMR split errors start with "Error: "; the issue list already says it is an error.
  const msg = (err instanceof Error ? err.message : String(err)).replace(/^Error:\s*/, "")
  let code = "SPLIT_FAILED"
  if (msg.includes("None of the required columns")) code = "MISSING_SPLIT_IDENTIFIER_COLUMN"
  else if (msg.includes("No valid date identifiers") || msg.includes("have no date in their identifier")) code = "NO_IDENTIFIER_DATES"
  else if (msg.includes("Some sample rows contain ETP/STP")) code = "SPLIT_IDENTIFIER_INCONSISTENT"
  return splitIssue({ rowNumber: null, fieldName: "csv", errorCode: code, errorMessage: msg })
}

function single(result: ValidationResult, filename: string, date: string | null): SplitValidationResult {
  return {
    ok: true,
    splitMode: "none",
    aggregated: { ...result, splitFiles: [filename], splitCount: 1, logicalFileCount: 1 },
    artifacts: [
      { filename, csvText: "", splitKey: "original", splitGroup: "original", collectionDateYmd: date, splitMode: "none", splitIndex: 0 },
    ],
  }
}

export function runSplitValidation(input: SplitValidationInput): SplitValidationResult {
  const strategy = resolveSplitStrategy(input.layout)
  const samples = samplesPerPlate(input.layout.counts)
  const dates = [...new Set(input.sampleDates)]
  const engine = (csvText: string, filename: string, overrides: Partial<Parameters<typeof validateRunExport>[0]>) =>
    validateRunExport({
      filename,
      csvText,
      kit: input.kit,
      layout: input.layout,
      rules: input.rules,
      instrument: input.instrument,
      centre: input.centre,
      sampleDates: dates,
      now: input.now,
      ...overrides,
    })

  const needed = expectedDateCount(input.layout)
  if (dates.length !== needed) {
    return {
      ok: false,
      issues: [
        splitIssue({
          rowNumber: null,
          fieldName: "sampleCollectionDate",
          errorCode: "MISSING_PLATE_DATES",
          errorMessage:
            needed === 1
              ? "Enter one sample collection date."
              : `This project's plates carry ${needed} samples from different dates: enter ${needed} different collection dates.`,
        }),
      ],
    }
  }

  // ---------- One sample per plate ----------
  if (strategy === "none") {
    try {
      const groups = discoverIdentifierGroupCount(input.csvText, false)
      if (groups > 1) {
        return {
          ok: false,
          issues: [
            splitIssue({
              rowNumber: null,
              fieldName: "csv",
              errorCode: "MULTIPLE_SAMPLES_SINGLE_PLATE",
              errorMessage: `This CSV contains ${groups} ETP/STP groups but the project's plate layout has one sample per plate.`,
            }),
          ],
        }
      }
    } catch {
      // No identifier columns to group by: a single-sample upload.
    }
    return single(engine(input.csvText, input.filename, {}), input.filename, dates[0])
  }

  // ---------- Several samples: file name, whole plate, then split ----------
  const nameIssues = validateUploadFilename(input.filename, input.centre, dates, input.now)
  if (nameIssues.length > 0) return { ok: false, issues: nameIssues }

  // Every sample row needs an identifier, naming as many samples as the plate holds.
  const identifierIssues = checkSampleIdentifiers(input.csvText, strategy, samples)
  if (identifierIssues.length > 0) return { ok: false, issues: identifierIssues }

  const whole = engine(input.csvText, input.filename, { checkFilename: false })
  if (!whole.passed) return { ok: false, issues: whole.issues }

  let artifacts: SplitArtifact[]
  try {
    if (strategy === "by_date") {
      const parsedName = input.centre ? parseUploadFilename(input.filename, input.centre) : null
      const base = parsedName?.ok ? parsedName.name.prefix : input.filename.replace(/\.csv$/i, "")
      artifacts = splitByCollectionDates(input.csvText, base)
    } else {
      const groups = discoverIdentifierGroupCount(input.csvText, true)
      if (groups !== samples) {
        return {
          ok: false,
          issues: [
            splitIssue({
              rowNumber: null,
              fieldName: "csv",
              errorCode: "SPLIT_GROUP_COUNT_MISMATCH",
              errorMessage: `Expected ${samples} site identifiers (one per sample) in Sample Name, Sample or Biological Set Name, found ${groups}.`,
            }),
          ],
        }
      }
      artifacts = splitByIdentifier(input.csvText, input.filename, dates[0], true)
    }
  } catch (error) {
    return { ok: false, issues: [splitFailure(error)] }
  }

  if (artifacts.length !== samples) {
    return {
      ok: false,
      issues: [
        splitIssue({
          rowNumber: null,
          fieldName: "csv",
          errorCode: "SPLIT_GROUP_COUNT_MISMATCH",
          errorMessage: `Expected ${samples} split file(s) by date, found ${artifacts.length}. Check identifier column dates.`,
        }),
      ],
    }
  }
  if (strategy === "by_date") {
    const found = artifacts.map((a) => a.collectionDateYmd ?? "")
    if (found.some((d) => !dates.includes(d))) {
      return {
        ok: false,
        issues: [
          splitIssue({
            rowNumber: null,
            fieldName: "csv",
            errorCode: "SPLIT_DATE_MISMATCH",
            errorMessage: `The sample identifiers carry the dates ${found.map(display).join(", ")} but the collection dates entered are ${dates.map(display).join(", ")}.`,
          }),
        ],
      }
    }
  }

  // ---------- Each split against its own sample's wells ----------
  const issues: ValidationIssue[] = []
  const details: string[] = [`Split files processed: ${artifacts.length}`]
  for (const artifact of artifacts) {
    const result = engine(artifact.csvText, artifact.filename, {
      checkFilename: false,
      samplesInFile: 1,
      sampleDates: artifact.collectionDateYmd ? [artifact.collectionDateYmd] : dates,
    })
    for (const i of result.issues) issues.push({ ...i, errorMessage: `[${artifact.filename}] ${i.errorMessage}` })
    for (const d of result.details) details.push(`[${artifact.filename}] ${d}`)
    details.push(`[${artifact.filename}] Split from original file: ${input.filename}`)
  }

  const ordered = prioritizeValidationIssues(issues)
  return {
    ok: true,
    splitMode: strategy,
    artifacts,
    aggregated: {
      passed: !ordered.some((i) => i.severity === "error"),
      issues: ordered,
      details,
      splitFiles: artifacts.map((a) => a.filename),
      splitCount: artifacts.length,
      logicalFileCount: artifacts.length,
    },
  }
}
