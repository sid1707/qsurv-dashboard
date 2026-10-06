// From vrdl-next-platform lib/upload/path.ts. QSurv keeps every project file in
// one bucket under <project_code>/<centre_id>/, which the storage policies check.

export const UPLOAD_BUCKET = "qsurv-files"

export type UploadFileKind = "results" | "runfile"
/** Folders under an upload: the two uploaded files, and the per-sample files split from a multi-sample run. */
export type UploadFolderKind = UploadFileKind | "splits"

const SAFE_FILENAME_REGEX = /[^a-zA-Z0-9._-]/g

export function toSafeFilename(filename: string) {
  return filename.trim().replace(SAFE_FILENAME_REGEX, "_").slice(0, 120)
}

export function uploadFolder(projectCode: string, centreId: string, uploadId: string, kind: UploadFolderKind) {
  return `${projectCode}/${centreId}/${uploadId}/${kind}/`
}

export function buildUploadPath(projectCode: string, centreId: string, uploadId: string, kind: UploadFolderKind, filename: string) {
  const fallback = kind === "runfile" ? "run.bin" : "results.csv"
  return `${uploadFolder(projectCode, centreId, uploadId, kind)}${toSafeFilename(filename || fallback)}`
}

/** The browser reports where it stored a file; only paths in this upload's own folder are accepted. */
export function isOwnUploadPath(
  ref: { bucket: string; storagePath: string },
  projectCode: string,
  centreId: string,
  uploadId: string,
  kind: UploadFileKind
) {
  const folder = uploadFolder(projectCode, centreId, uploadId, kind)
  const rest = ref.storagePath.slice(folder.length)
  return ref.bucket === UPLOAD_BUCKET && ref.storagePath.startsWith(folder) && rest.length > 0 && !rest.includes("/")
}
