import { exampleFileName, fileNamePrefix } from "@/lib/centres/file-name"
import { INSTRUMENT_PROFILES, fileExtension, type InstrumentId } from "@/lib/qpcr/instruments"
import type { ValidationIssue } from "./types"

/**
 * File name rules, from vrdl-next-platform validateFilename,
 * src/lib/vrdl/filename.ts and lib/upload/filename-match.ts. The AMR name
 * VRDL##_Name_Location_DDMMYY becomes <Centre ID>_<Name>_<Location>_<DDMMYY>
 * (lib/centres/file-name.ts). As in the AMR portal: dates are read only right
 * after the location, several dates may follow each other, DDMMYY and DDMMYYYY
 * are equivalent, anything after the dates (e.g. "_Results", " - export") is
 * ignored, and the run file must carry the same centre ID and dates as the CSV.
 */

export type CentreFileIdentity = { centreId: string | null; fileCode: string }

const FUTURE_DAYS_ALLOWED = 7

function fail(fieldName: string, errorCode: string, errorMessage: string): ValidationIssue {
  return { rowNumber: null, fieldName, errorCode, errorMessage, severity: "error" }
}

function validDate(year: number, month: number, day: number) {
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? d : null
}

/** A DDMMYY or DDMMYYYY token as an ISO date, or null when it is not a real date. */
export function parseDateToken(token: string): string | null {
  const m = token.match(/^(\d{2})(\d{2})(\d{2}|\d{4})$/)
  if (!m) return null
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  if (year < 2000 || year > 2100) return null
  const d = validDate(year, Number(m[2]), Number(m[1]))
  return d ? d.toISOString().slice(0, 10) : null
}

/** File name without folder, extension, or junk after " - " (legacy parity). */
export function filenameStem(filename: string) {
  let stem = filename.replace(/^.*[/\\]/, "").replace(/\.[^.]+$/, "")
  if (stem.includes(" - ")) stem = stem.split(" - ")[0].trim()
  return stem
}

export type ParsedUploadName = {
  /** The centre ID and code as written in the file name, e.g. "C01_AIIMS_NewDelhi". */
  prefix: string
  /** ISO dates in the order they appear, without repeats. */
  dates: string[]
}

export function parseUploadFilename(
  filename: string,
  centre: CentreFileIdentity,
  fieldName = "filename"
): { ok: true; name: ParsedUploadName } | { ok: false; issue: ValidationIssue } {
  if (!centre.centreId) {
    return {
      ok: false,
      issue: fail(fieldName, "CENTRE_ID_MISSING", "Your centre has no centre ID yet. Ask your project admin to set it."),
    }
  }
  const expected = fileNamePrefix({ centreId: centre.centreId, fileCode: centre.fileCode }).split("_")
  const parts = filenameStem(filename).split("_")
  const example = exampleFileName({ centreId: centre.centreId, fileCode: centre.fileCode })

  if (parts[0]?.toUpperCase() !== expected[0].toUpperCase()) {
    return {
      ok: false,
      issue: fail(
        fieldName,
        "CENTRE_ID_MISMATCH",
        `File name starts with '${parts[0]}' but your centre ID is ${centre.centreId}. Expected ${example}.`
      ),
    }
  }
  const codeMatches = expected.every((part, i) => (parts[i] ?? "").toLowerCase() === part.toLowerCase())
  if (!codeMatches) {
    return {
      ok: false,
      issue: fail(
        fieldName,
        "CENTRE_CODE_MISMATCH",
        `File name must start with ${expected.join("_")}_ (your centre ID, then the centre name and location without spaces). Expected ${example}.`
      ),
    }
  }

  const dates: string[] = []
  for (const part of parts.slice(expected.length)) {
    const date = parseDateToken(part)
    if (!date) break
    if (!dates.includes(date)) dates.push(date)
  }
  if (dates.length === 0) {
    return {
      ok: false,
      issue: fail(fieldName, "INVALID_FILENAME_FORMAT", `No collection date after the centre code. Expected ${example} (or DDMMYYYY).`),
    }
  }
  return { ok: true, name: { prefix: parts.slice(0, expected.length).join("_"), dates } }
}

const display = (iso: string) => iso.split("-").reverse().join("/")

/**
 * The results export's name. With one collection date the first date in the
 * name must be it; with several (multi-date plates) the set of dates must match.
 */
export function validateUploadFilename(
  filename: string,
  centre: CentreFileIdentity | null,
  sampleDates: string[],
  now = new Date(),
  fieldName = "filename"
): ValidationIssue[] {
  if (fieldName === "filename" && fileExtension(filename) !== ".csv") {
    return [fail(fieldName, "UNSUPPORTED_FILE_EXTENSION", "The results export must be a .csv file.")]
  }
  if (!centre) return []

  const parsed = parseUploadFilename(filename, centre, fieldName)
  if (!parsed.ok) return [parsed.issue]
  const { dates } = parsed.name

  const limit = new Date(now.getTime() + FUTURE_DAYS_ALLOWED * 86_400_000).toISOString().slice(0, 10)
  if (dates[0] > limit) {
    return [fail(fieldName, "FILENAME_DATE_FUTURE", `Date in file name (${display(dates[0])}) is too far in the future.`)]
  }

  if (sampleDates.length === 1 && dates[0] !== sampleDates[0]) {
    return [fail(fieldName, "FILENAME_DATE_MISMATCH", "File name date does not match the selected sample collection date.")]
  }
  if (sampleDates.length > 1) {
    const expected = new Set(sampleDates)
    if (expected.size !== dates.length) {
      return [
        fail(fieldName, "FILENAME_DATE_COUNT_MISMATCH", `Expected ${expected.size} date token(s) in the file name, found ${dates.length}.`),
      ]
    }
    if (dates.some((d) => !expected.has(d))) {
      return [fail(fieldName, "FILENAME_DATE_MISMATCH", "Date tokens in the file name do not match the selected sample dates.")]
    }
  }
  return []
}

/**
 * The run file: the instrument's native file, named by the same rules, with the
 * same centre ID and dates as the CSV (the name and location may differ).
 */
export function validateRunfile(
  csvFilename: string,
  runFilename: string | null,
  instrument: InstrumentId,
  centre: CentreFileIdentity | null = null,
  sampleDates: string[] = []
): ValidationIssue[] {
  if (!runFilename) return [fail("runFilename", "RUNFILE_REQUIRED", "Run file is required.")]

  const profile = INSTRUMENT_PROFILES[instrument]
  if (!profile.runfileExtensions.includes(fileExtension(runFilename))) {
    return [
      fail(
        "runFilename",
        "RUNFILE_EXTENSION",
        `${profile.label} run files must be ${profile.runfileExtensions.join(" or ")}. Got '${runFilename}'.`
      ),
    ]
  }
  if (!centre) return []

  const nameIssues = validateUploadFilename(runFilename, centre, sampleDates, undefined, "runFilename")
  if (nameIssues.length > 0) return nameIssues

  const csv = parseUploadFilename(csvFilename, centre)
  const run = parseUploadFilename(runFilename, centre)
  const sameDates =
    csv.ok && run.ok && csv.name.dates.length === run.name.dates.length && csv.name.dates.every((d) => run.name.dates.includes(d))
  if (!sameDates) {
    return [
      fail(
        "runFilename",
        "RUNFILE_CSV_NAME_MISMATCH",
        `The run file '${runFilename}' and the CSV '${csvFilename}' are not the same run: both must have your centre ID and the same date(s). DDMMYY and DDMMYYYY count as the same.`
      ),
    ]
  }
  return []
}
