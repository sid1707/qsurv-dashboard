import { describe, expect, it } from "vitest"
import {
  formatDmySlashFromYmd,
  localDateToYmd,
  parseDmySlashToYmd,
  ymdToLocalDate,
} from "../lib/dashboard/date-input"

describe("date input helpers", () => {
  it("formats ISO to DD/MM/YYYY", () => {
    expect(formatDmySlashFromYmd("2025-06-17")).toBe("17/06/2025")
  })

  it("parses DD/MM/YYYY to ISO", () => {
    expect(parseDmySlashToYmd("17/06/2025")).toBe("2025-06-17")
    expect(parseDmySlashToYmd("1/3/2024")).toBe("2024-03-01")
  })

  it("rejects invalid calendar dates", () => {
    expect(parseDmySlashToYmd("31/02/2025")).toBeNull()
    expect(parseDmySlashToYmd("not-a-date")).toBeNull()
  })

  it("accepts existing ISO input", () => {
    expect(parseDmySlashToYmd("2025-06-17")).toBe("2025-06-17")
  })

  it("round-trips ISO through local Date", () => {
    const d = ymdToLocalDate("2025-06-17")
    expect(d).toBeDefined()
    expect(localDateToYmd(d!)).toBe("2025-06-17")
  })
})
