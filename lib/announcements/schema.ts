// Ported from vrdl-next-platform lib/announcements/schema.ts, scoped to one
// project. Audience values match the announcement_audience enum.

export type AnnouncementAudience = "all_centres" | "selected_centres"

export type ParseResult<T> = { ok: true; data: T } | { ok: false; message: string }

export type CreateAnnouncementInput = {
  title: string
  body: string
  audience: AnnouncementAudience
  centreIds: string[]
}

export const ANNOUNCEMENT_TITLE_MAX = 120
export const ANNOUNCEMENT_BODY_MAX = 4000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function asTrimmedString(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.trim().replace(/\s+/g, " ")
}

function asMultilineString(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.replace(/\r\n/g, "\n").trim()
}

function parseAudience(value: unknown): AnnouncementAudience | null {
  if (value === "all_centres" || value === "selected_centres") return value
  return null
}

function parseCentreIds(value: unknown): string[] | null {
  if (value == null) return []
  const raw = Array.isArray(value) ? value : [value]
  const ids: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== "string") return null
    const id = item.trim()
    if (!id) continue
    if (!UUID_RE.test(id)) return null
    const key = id.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    ids.push(id)
  }
  return ids
}

export function parseCreateAnnouncementInput(raw: {
  title: unknown
  body: unknown
  audience: unknown
  centreIds: unknown
}): ParseResult<CreateAnnouncementInput> {
  const title = asTrimmedString(raw.title)
  if (!title) return { ok: false, message: "Title is required." }
  if (title.length > ANNOUNCEMENT_TITLE_MAX) {
    return { ok: false, message: `Title must be ${ANNOUNCEMENT_TITLE_MAX} characters or fewer.` }
  }

  const body = asMultilineString(raw.body)
  if (!body) return { ok: false, message: "Message is required." }
  if (body.length > ANNOUNCEMENT_BODY_MAX) {
    return { ok: false, message: `Message must be ${ANNOUNCEMENT_BODY_MAX} characters or fewer.` }
  }

  const audience = parseAudience(raw.audience)
  if (!audience) return { ok: false, message: "Choose whether this goes to all centres or selected centres." }

  const centreIds = parseCentreIds(raw.centreIds)
  if (!centreIds) return { ok: false, message: "One or more selected centres are invalid." }

  if (audience === "all_centres" && centreIds.length > 0) {
    return { ok: false, message: "Do not select individual centres when sending to all centres." }
  }
  if (audience === "selected_centres" && centreIds.length === 0) {
    return { ok: false, message: "Select at least one centre." }
  }

  return { ok: true, data: { title, body, audience, centreIds } }
}

export function parseAnnouncementId(value: unknown): string | null {
  if (typeof value !== "string") return null
  const id = value.trim()
  return UUID_RE.test(id) ? id : null
}
