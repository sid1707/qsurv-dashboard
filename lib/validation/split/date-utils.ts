// Ported unchanged from vrdl-next-platform src/lib/split/date-utils.ts.

/** Normalize various date strings to DDMMYY (legacy normalize_date parity). */
export function normalizeDateToken(dateStr: string | null | undefined): string | null {
  if (dateStr == null || String(dateStr).trim() === "") return null
  const s = String(dateStr).trim()
  if (/^\d{6}$/.test(s) && isValid6Digit(s)) return s
  if (/^\d{8}$/.test(s) && isValid8Digit(s)) return s.slice(0, 4) + s.slice(6, 8)

  const patterns = [
    /^(\d{2})-(\d{2})-(\d{2})$/,
    /^(\d{2})-(\d{2})-(\d{4})$/,
    /^(\d{2})\.(\d{2})\.(\d{2})$/,
    /^(\d{2})\.(\d{2})\.(\d{4})$/,
  ]
  for (const p of patterns) {
    const m = s.match(p)
    if (m) {
      const dd = m[1]
      const mm = m[2]
      const year = m[3].length === 2 ? m[3] : m[3].slice(-2)
      return `${dd}${mm}${year}`
    }
  }

  const suffixPatterns = [
    /_(\d{2}-\d{2}-\d{2})$/,
    /_(\d{2}-\d{2}-\d{4})$/,
    /_(\d{2}\.\d{2}\.\d{2})$/,
    /_(\d{2}\.\d{2}\.\d{4})$/,
    /_(\d{8})$/,
    /_(\d{6})$/,
    /(\d{2}\.\d{2}\.\d{2}|\d{2}\.\d{2}\.\d{4})$/,
  ]
  for (const p of suffixPatterns) {
    const m = s.match(p)
    if (m) return normalizeDateToken(m[1])
  }
  return null
}

function isValid6Digit(dateStr: string): boolean {
  const day = Number(dateStr.slice(0, 2))
  const month = Number(dateStr.slice(2, 4))
  const year = 2000 + Number(dateStr.slice(4, 6))
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2000 && year <= 2100
}

function isValid8Digit(dateStr: string): boolean {
  const day = Number(dateStr.slice(0, 2))
  const month = Number(dateStr.slice(2, 4))
  const year = Number(dateStr.slice(4, 8))
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2000 && year <= 2100
}

/** ISO YYYY-MM-DD from DDMMYY token. */
export function ddmmyyToYmd(token: string): string | null {
  const norm = normalizeDateToken(token)
  if (!norm || norm.length !== 6) return null
  const day = norm.slice(0, 2)
  const month = norm.slice(2, 4)
  const year = 2000 + Number(norm.slice(4, 6))
  return `${year}-${month}-${day}`
}

/** DDMMYY from ISO YYYY-MM-DD. */
export function ymdToDdmmyy(ymd: string): string | null {
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return `${m[3]}${m[2]}${m[1].slice(-2)}`
}

export function extractDateFromIdentifier(sampleValue: string | null | undefined): string | null {
  if (sampleValue == null) return null
  const sampleStr = String(sampleValue).trim()
  if (["PC", "NC"].includes(sampleStr.toUpperCase())) return null
  return normalizeDateToken(sampleStr)
}
