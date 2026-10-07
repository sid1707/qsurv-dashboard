import { NextResponse } from "next/server"
import { parsePlateComposition } from "@/lib/plate/layout"
import { isInstrumentId } from "@/lib/qpcr/instruments"
import { forbiddenFromAuth, jsonError, logUploadStage } from "@/lib/upload/api"
import { centreIdentity, getCentreUploadContext, parseSampleDates } from "@/lib/upload/centre-context"
import { checkRun, splitValidationIssues } from "@/lib/upload/run-check"
import { loadValidationSetup } from "@/lib/validation/setup"
import { RESULTS_MAX_BYTES } from "@/lib/upload/client-types"

/** Checks a results export before anything is stored. From vrdl-next-platform app/api/uploads/validate. */
export async function POST(request: Request) {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return jsonError(400, { message: "Expected multipart form data", code: "INVALID_BODY", stage: "validate" })
  }

  const auth = await getCentreUploadContext(form.get("projectCode"), { requireActiveCentre: true })
  if (!auth.ok) return forbiddenFromAuth(auth.reason, "validate")
  const { context } = auth

  const file = form.get("results")
  if (!(file instanceof File) || file.size === 0) {
    return jsonError(400, { message: "Choose the results export (.csv).", code: "CSV_REQUIRED", stage: "validate" })
  }
  if (file.size > RESULTS_MAX_BYTES) {
    return jsonError(413, { message: "The results export is larger than 5 MB. Check you chose the right file.", code: "CSV_TOO_LARGE", stage: "validate" })
  }
  const instrument = String(form.get("instrument") ?? "")
  if (!isInstrumentId(instrument) || !context.instruments.includes(instrument)) {
    return jsonError(400, { message: "Choose one of the project's instruments.", code: "INVALID_INSTRUMENT", stage: "validate" })
  }
  const sampleDates = parseSampleDates(form.getAll("sampleCollectionDates"))
  if (!sampleDates) {
    return jsonError(400, { message: "Enter the sample collection date(s) as DD/MM/YYYY.", code: "MISSING_FIELD", stage: "validate" })
  }

  const composition = parsePlateComposition(form.get("plateSamples"), form.get("plateMode"))
  if (!composition) {
    return jsonError(400, { message: "Choose the plate composition.", code: "INVALID_PLATE_COMPOSITION", stage: "validate" })
  }

  const setup = await loadValidationSetup(context.supabase, context.project)
  const result = checkRun(setup, {
    filename: file.name,
    csvText: await file.text(),
    instrument,
    sampleDates,
    composition,
    runFilename: String(form.get("runFilename") ?? "") || null,
    centre: centreIdentity(context.centre),
  })
  const { errors, warnings } = splitValidationIssues(result.issues)

  logUploadStage("validate", {
    projectCode: context.project.code,
    centreId: context.centre.id,
    filename: file.name,
    errorCount: errors.length,
    warningCount: warnings.length,
    passed: result.passed,
  })

  return NextResponse.json({
    passed: result.passed,
    hasBlockingErrors: errors.length > 0,
    hasWarnings: warnings.length > 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    issues: result.issues,
    details: result.details,
  })
}
