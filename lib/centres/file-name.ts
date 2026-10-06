/**
 * Upload file names: <Centre ID>_<Centre name>_<Location>_<DDMMYY>[_<DDMMYY>...]
 * (the AMR portal's VRDL##_Name_Location_Date with a project-given centre ID).
 *
 *   - Centre ID: given by the project admin when adding the centre's users,
 *     e.g. C01. Letters, digits and hyphens.
 *   - Centre code: the centre's name and location with everything but letters
 *     and digits removed, joined by "_", e.g. AIIMS_NewDelhi. The database
 *     fills centres.file_code the same way (private.centre_file_code) and stops
 *     changing it once the centre has uploads.
 */

export const CENTRE_ID_PATTERN = /^[A-Za-z0-9-]{1,20}$/
export const CENTRE_ID_HINT = "Up to 20 letters, digits or hyphens, e.g. C01 (no spaces or underscores)."

const squash = (value: string | null | undefined) => (value ?? "").replace(/[^A-Za-z0-9]/g, "")

export function centreFileCode(name: string, location: string | null | undefined): string {
  return [squash(name), squash(location)].filter(Boolean).join("_")
}

export function normaliseCentreId(value: string) {
  return value.trim().toUpperCase()
}

/** The prefix every file name for the centre starts with, e.g. "C01_AIIMS_NewDelhi". */
export function fileNamePrefix(centre: { centreId: string; fileCode: string }) {
  return `${centre.centreId}_${centre.fileCode}`
}

/** An example name, for the forms: one date token per expected date. */
export function exampleFileName(centre: { centreId: string; fileCode: string }, dates = 1, extension = ".csv") {
  return `${fileNamePrefix(centre)}_${Array.from({ length: dates }, () => "DDMMYY").join("_")}${extension}`
}
