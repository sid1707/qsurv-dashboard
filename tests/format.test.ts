import { describe, expect, it } from "vitest"
import {
  DISPLAY,
  formatDateFromDb,
  formatDateTimeIso,
  formatDateYmd,
  formatInteger,
  formatVolumeMl,
  localDateToYmd,
  parseDisplayDateToYmd,
  ymdToLocalDate,
} from "../lib/format"

describe("formatDateYmd", () => {
  it("formats ISO to DD/MM/YYYY", () => {
    expect(formatDateYmd("2025-06-17")).toBe("17/06/2025")
  })

  it("returns empty marker for invalid or missing", () => {
    expect(formatDateYmd(null)).toBe(DISPLAY.empty)
    expect(formatDateYmd("")).toBe(DISPLAY.empty)
    expect(formatDateYmd("31/02/2025")).toBe(DISPLAY.empty)
  })
})

describe("formatDateFromDb", () => {
  it("uses first 10 chars of timestamptz", () => {
    expect(formatDateFromDb("2025-06-17T00:00:00+00:00")).toBe("17/06/2025")
  })
})

describe("parseDisplayDateToYmd", () => {
  it("parses DD/MM/YYYY to ISO", () => {
    expect(parseDisplayDateToYmd("17/06/2025")).toBe("2025-06-17")
    expect(parseDisplayDateToYmd("1/3/2024")).toBe("2024-03-01")
  })

  it("rejects invalid calendar dates", () => {
    expect(parseDisplayDateToYmd("31/02/2025")).toBeNull()
    expect(parseDisplayDateToYmd("not-a-date")).toBeNull()
  })

  it("accepts existing ISO input", () => {
    expect(parseDisplayDateToYmd("2025-06-17")).toBe("2025-06-17")
  })

  it("round-trips ISO through local Date", () => {
    const d = ymdToLocalDate("2025-06-17")
    expect(d).toBeDefined()
    expect(localDateToYmd(d!)).toBe("2025-06-17")
  })
})

describe("formatDateTimeIso", () => {
  it("formats UTC instant in IST", () => {
    expect(formatDateTimeIso("2025-06-17T18:30:00.000Z")).toBe("18/06/2025, 00:00")
  })

  it("returns empty marker for invalid", () => {
    expect(formatDateTimeIso(null)).toBe(DISPLAY.empty)
    expect(formatDateTimeIso("not-a-date")).toBe(DISPLAY.empty)
  })
})

describe("formatVolumeMl", () => {
  it("formats volume with mL unit", () => {
    expect(formatVolumeMl(2.5)).toBe("2.5 mL")
    expect(formatVolumeMl(2)).toBe("2 mL")
  })

  it("returns empty marker for missing", () => {
    expect(formatVolumeMl(null)).toBe(DISPLAY.empty)
  })
})

describe("formatInteger", () => {
  it("uses en-IN grouping", () => {
    expect(formatInteger(125000)).toBe("1,25,000")
  })
})
