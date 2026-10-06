/** Indian display conventions for the VRDL portal (dates, times, units). Storage stays ISO. */

export const DISPLAY = {
  locale: "en-IN",
  timeZone: "Asia/Kolkata",
  datePattern: "DD/MM/YYYY",
  dateTimePattern: "DD/MM/YYYY, HH:mm",
  units: { volume: "mL", dnaConcentration: "ng/µL" },
  empty: "—",
} as const

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return false
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
}

/** Format a Postgres `date` or timestamptz string (uses first 10 chars as YYYY-MM-DD). */
export function formatDateFromDb(value: string | null | undefined): string {
  if (!value?.trim()) return DISPLAY.empty
  return formatDateYmd(value.trim().slice(0, 10))
}

/** Display ISO YYYY-MM-DD as DD/MM/YYYY. */
export function formatDateYmd(ymd: string | null | undefined): string {
  if (!ymd?.trim()) return DISPLAY.empty
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return DISPLAY.empty
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (!isValidCalendarDate(year, month, day)) return DISPLAY.empty
  return `${m[3]}/${m[2]}/${m[1]}`
}

/** Parse DD/MM/YYYY (or existing YYYY-MM-DD) to ISO date for storage and APIs. */
export function parseDisplayDateToYmd(input: string): string | null {
  const s = input.trim()
  if (!s) return null

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    const year = Number(iso[1])
    const month = Number(iso[2])
    const day = Number(iso[3])
    return isValidCalendarDate(year, month, day) ? s : null
  }

  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!slash) return null

  const day = Number(slash[1])
  const month = Number(slash[2])
  const year = Number(slash[3])
  if (!isValidCalendarDate(year, month, day)) return null

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/** Local calendar date from ISO YYYY-MM-DD (for date pickers). */
export function ymdToLocalDate(ymd: string): Date | undefined {
  const iso = parseDisplayDateToYmd(ymd) ?? (ymd.trim().match(/^\d{4}-\d{2}-\d{2}$/) ? ymd.trim() : null)
  if (!iso) return undefined
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, m - 1, d)
}

/** ISO YYYY-MM-DD from a local calendar Date. */
export function localDateToYmd(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

const dateTimeFormatter = new Intl.DateTimeFormat(DISPLAY.locale, {
  timeZone: DISPLAY.timeZone,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? ""
}

/** Display ISO timestamptz as DD/MM/YYYY, HH:mm in IST. */
export function formatDateTimeIso(iso: string | null | undefined): string {
  if (!iso?.trim()) return DISPLAY.empty
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return DISPLAY.empty

  const parts = dateTimeFormatter.formatToParts(d)
  const day = partValue(parts, "day").padStart(2, "0")
  const month = partValue(parts, "month").padStart(2, "0")
  const year = partValue(parts, "year")
  const hour = partValue(parts, "hour").padStart(2, "0")
  const minute = partValue(parts, "minute").padStart(2, "0")

  return `${day}/${month}/${year}, ${hour}:${minute}`
}

const integerFormatter = new Intl.NumberFormat(DISPLAY.locale, { maximumFractionDigits: 0 })

/** Integer with en-IN grouping (e.g. 1,25,000). */
export function formatInteger(value: number): string {
  return integerFormatter.format(value)
}

/** Volume in millilitres for display. */
export function formatVolumeMl(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return DISPLAY.empty
  const n = Number(value)
  const numStr = Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(10)))
  return `${numStr} ${DISPLAY.units.volume}`
}
