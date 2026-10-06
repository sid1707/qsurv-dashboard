// From vrdl-next-platform lib/api/upload-errors.ts.

import { NextResponse } from "next/server"
import type { ValidationIssue } from "@/lib/validation/types"

export type UploadStage = "validate" | "start" | "signed_url" | "submit" | "auth"

export type UploadApiErrorBody = {
  message: string
  code: string
  stage?: UploadStage
  issues?: ValidationIssue[]
  details?: string[]
}

export type CentreAuthFailureReason =
  | "no_session"
  | "not_centre_user"
  | "feature_off"
  | "centre_inactive"
  | "centre_id_missing"

const AUTH_MESSAGES: Record<CentreAuthFailureReason, string> = {
  no_session: "Your session expired. Sign in again and retry.",
  not_centre_user: "Only centre users of this project can upload runs.",
  feature_off: "Uploads are not switched on for this project.",
  centre_inactive: "Your centre has been deactivated in this project. Contact your project admin.",
  centre_id_missing: "Your centre has no centre ID yet, so its files cannot be named. Ask your project admin to set it.",
}

export function jsonError(status: number, body: UploadApiErrorBody) {
  return NextResponse.json(body, { status })
}

export function forbiddenFromAuth(reason: CentreAuthFailureReason, stage: UploadStage = "auth") {
  logUploadStage(stage, { level: "error", code: "AUTH_FORBIDDEN", authReason: reason })
  return jsonError(reason === "no_session" ? 401 : 403, { message: AUTH_MESSAGES[reason], code: "AUTH_FORBIDDEN", stage })
}

type LogMeta = Record<string, string | number | boolean | null | undefined>

/** Structured log lines; search for "event":"upload_pipeline". */
export function logUploadStage(stage: UploadStage | string, meta: LogMeta & { level?: "info" | "error" }) {
  const { level = "info", ...rest } = meta
  const payload = { event: "upload_pipeline", stage, ...rest, ts: new Date().toISOString() }
  if (level === "error") console.error(JSON.stringify(payload))
  else console.info(JSON.stringify(payload))
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}
