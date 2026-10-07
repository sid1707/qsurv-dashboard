import { readFileSync } from "node:fs"
import path from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import { SINGLE_SAMPLE, presetLayout, type PlateLayout } from "../lib/plate/layout"
import { checkRun } from "../lib/upload/run-check"
import type { CentreFileIdentity } from "../lib/validation/filename"
import { buildValidationSetup, type ValidationSetup } from "../lib/validation/setup"
import { expectedDateCount, resolveSplitStrategy, runSplitValidation, type SplitValidationInput } from "../lib/validation/split/router"
import { createMigratedDb } from "./db/harness"

const RUNS = path.resolve(__dirname, "fixtures/runs")
const run = (name: string) => readFileSync(path.join(RUNS, name), "utf8")
const NOW = new Date("2026-10-10T00:00:00Z")

const TWO_DATES = "C01_HuwelLab_Pune_01102026_08102026_two-dates.csv"
const TWO_DATES_SCATTERED = "C01_HuwelLab_Pune_01102026_08102026_two-dates_scattered.csv"
const TWO_SITES = "C02_EnvLab_Mumbai_01102026_two-sites.csv"
const ONE_SAMPLE = "C01_HuwelLab_Pune_01102026_quantstudio5.csv"
const PUNE: CentreFileIdentity = { centreId: "C01", fileCode: "HuwelLab_Pune" }
const MUMBAI: CentreFileIdentity = { centreId: "C02", fileCode: "EnvLab_Mumbai" }

let multipathogen: ValidationSetup
let environmental: ValidationSetup

/** The plate a centre runs when it picks two samples per plate on upload (the same as expandLayout builds). */
const twoSamples = (setup: ValidationSetup, mode: "dates" | "sites"): PlateLayout =>
  presetLayout(setup.panel, { unknownReplicates: 3, pc: 1, nc: 1, samples: 2 }, mode)

beforeAll(async () => {
  const db = await createMigratedDb()
  const load = async (name: string) => {
    const { rows } = await db.query<{ kit: never }>(
      `select jsonb_build_object('id', k.id, 'name', k.name, 'version', k.version, 'layout_orientation', k.layout_orientation,
         'rule_defaults', k.rule_defaults,
         'kit_targets', (select jsonb_agg(to_jsonb(t)) from public.kit_targets t where t.kit_id = k.id)) as kit
       from public.kits k where k.name = $1`,
      [name]
    )
    return buildValidationSetup(rows[0].kit, { plate_layout: null, qc_rules: null })
  }
  multipathogen = await load("Huwel Multipathogen")
  environmental = await load("Huwel Environmental Surveillance")
}, 60_000)

function split(setup: ValidationSetup, filename: string, overrides: Partial<SplitValidationInput> = {}) {
  return runSplitValidation({
    filename,
    csvText: run(filename),
    kit: setup.kit,
    layout: twoSamples(setup, "dates"),
    rules: setup.rules,
    instrument: "quantstudio_5",
    centre: PUNE,
    sampleDates: ["2026-10-01", "2026-10-08"],
    now: NOW,
    ...overrides,
  })
}

const codes = (r: { ok: boolean; issues?: { errorCode: string }[]; aggregated?: { issues: { errorCode: string }[] } }) =>
  (r.ok ? r.aggregated!.issues : r.issues!).map((i) => i.errorCode)

describe("split strategy from the plate layout", () => {
  it("splits by date or by site only when the layout has several samples", () => {
    expect(resolveSplitStrategy(multipathogen.layout)).toBe("none")
    expect(resolveSplitStrategy(twoSamples(multipathogen, "dates"))).toBe("by_date")
    expect(resolveSplitStrategy(twoSamples(multipathogen, "sites"))).toBe("by_identifier")
    expect(expectedDateCount(twoSamples(multipathogen, "dates"))).toBe(2)
    expect(expectedDateCount(twoSamples(multipathogen, "sites"))).toBe(1)
  })
})

describe("multiple dates on one plate", () => {
  it("splits by the date in Sample Name, keeps the controls in each file, and validates each sample", () => {
    const result = split(multipathogen, TWO_DATES)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.aggregated.issues).toEqual([])
    expect(result.splitMode).toBe("by_date")
    expect(result.artifacts.map((a) => [a.filename, a.collectionDateYmd])).toEqual([
      ["C01_HuwelLab_Pune_011026.csv", "2026-10-01"],
      ["C01_HuwelLab_Pune_081026.csv", "2026-10-08"],
    ])
    // 3 sample wells + PC + NTC, three targets each.
    for (const a of result.artifacts) expect(a.csvText.trim().split("\n").filter((l) => /^\d+,A\d/.test(l))).toHaveLength(15)
    expect(result.aggregated.details).toContain("Split files processed: 2")
    expect(result.aggregated.details).toContain(
      "[C01_HuwelLab_Pune_081026.csv] Split from original file: C01_HuwelLab_Pune_01102026_08102026_two-dates.csv"
    )
  })

  it("splits by identifier wherever the samples sit in the unknown wells", () => {
    const result = split(multipathogen, TWO_DATES_SCATTERED)
    expect(result.ok && result.aggregated.issues).toEqual([])
    if (!result.ok) return
    const wells = (csv: string) => [...new Set(csv.split("\n").map((l) => l.split(",")[1]).filter((w) => /^A\d$/.test(w ?? "")))]
    expect(result.artifacts.map((a) => wells(a.csvText))).toEqual([
      ["A1", "A2", "A4", "A7", "A8"],
      ["A3", "A5", "A6", "A7", "A8"],
    ])
  })

  it("needs every sample to have the layout's replicates, whatever wells it uses", () => {
    // Four wells carry the first date and only two the second.
    const csv = run(TWO_DATES).replace(/^(4,A4,false,)WW_08102026,/gm, "$1WW_01102026,")
    const result = split(multipathogen, TWO_DATES, { csvText: csv })
    expect(result.ok && result.aggregated.passed).toBe(false)
    if (!result.ok) return
    const messages = result.aggregated.issues.filter((i) => i.errorCode === "MISSING_REPLICATES").map((i) => i.errorMessage)
    expect(messages).toContain(
      "[C01_HuwelLab_Pune_011026.csv] Replicates for target Target A do not match the plate layout. Expected 3 unknown replicates, 1 pos ctrl and 1 neg ctrl. Observed unknown replicates=4, pos ctrl=1, neg ctrl=1."
    )
    expect(messages).toContain(
      "[C01_HuwelLab_Pune_081026.csv] Replicates for target Target A do not match the plate layout. Expected 3 unknown replicates, 1 pos ctrl and 1 neg ctrl. Observed unknown replicates=2, pos ctrl=1, neg ctrl=1."
    )
  })

  it("needs one collection date per sample, matching the file name and the identifiers", () => {
    expect(codes(split(multipathogen, TWO_DATES, { sampleDates: ["2026-10-01"] }))).toEqual(["MISSING_PLATE_DATES"])
    expect(codes(split(multipathogen, TWO_DATES, { sampleDates: ["2026-10-01", "2026-10-09"] }))).toEqual(["FILENAME_DATE_MISMATCH"])

    const renamed = "C01_HuwelLab_Pune_01102026_09102026.csv"
    const result = runSplitValidation({
      filename: renamed,
      csvText: run(TWO_DATES),
      kit: multipathogen.kit,
      layout: twoSamples(multipathogen, "dates"),
      rules: multipathogen.rules,
      instrument: "quantstudio_5",
      centre: PUNE,
      sampleDates: ["2026-10-01", "2026-10-09"],
      now: NOW,
    })
    expect(codes(result)).toEqual(["SPLIT_DATE_MISMATCH"])
  })

  it("explains when the identifiers carry no dates", () => {
    const csv = run(TWO_DATES).replaceAll(",WW_01102026,", ",WW-A,").replaceAll(",WW_08102026,", ",WW-B,")
    const result = split(multipathogen, TWO_DATES, { csvText: csv })
    expect(codes(result)).toEqual(["NO_IDENTIFIER_DATES"])
  })

  it("checks the whole plate before splitting, so missing replicates are not hidden", () => {
    const csv = run(TWO_DATES).split("\n").filter((l) => !l.startsWith("6,A6,")).join("\n")
    const result = split(multipathogen, TWO_DATES, { csvText: csv })
    expect(result.ok).toBe(false)
    expect(codes(result)).toContain("MISSING_REPLICATES")
  })
})

describe("multiple sites on one plate", () => {
  const sites = (overrides: Partial<SplitValidationInput> = {}) =>
    split(environmental, TWO_SITES, {
      layout: twoSamples(environmental, "sites"),
      instrument: "biorad_cfx96",
      centre: MUMBAI,
      sampleDates: ["2026-10-01"],
      ...overrides,
    })

  it("splits by Biological Set Name, naming each file after its site as the AMR portal does", () => {
    const result = sites()
    expect(result.ok && result.aggregated.issues).toEqual([])
    if (!result.ok) return
    expect(result.splitMode).toBe("by_identifier")
    expect(result.artifacts.map((a) => [a.filename, a.splitKey, a.collectionDateYmd])).toEqual([
      ["C02_EnvLab-ETP_Mumbai_01102026_two-sites.csv", "ETP", "2026-10-01"],
      ["C02_EnvLab-STP_Mumbai_01102026_two-sites.csv", "STP", "2026-10-01"],
    ])
  })

  it("needs as many site identifiers as samples", () => {
    const csv = run(TWO_SITES).replaceAll(",STP,", ",ETP,").replaceAll("WW-STP", "WW-ETP")
    expect(codes(sites({ csvText: csv }))).toEqual(["SPLIT_GROUP_COUNT_MISMATCH"])
  })

  it("refuses a multi-site run when the layout has one sample per plate", () => {
    const result = sites({ layout: environmental.layout })
    expect(codes(result)).toEqual(["MULTIPLE_SAMPLES_SINGLE_PLATE"])
  })
})

describe("checkRun", () => {
  it("adds the run file check to the split result", () => {
    // The project's one-sample layout, widened to the upload's composition.
    const setup = multipathogen
    const composition = { samples: 2, mode: "dates" } as const
    const ok = checkRun(setup, {
      filename: TWO_DATES,
      csvText: run(TWO_DATES),
      instrument: "quantstudio_5",
      sampleDates: ["2026-10-01", "2026-10-08"],
      composition,
      runFilename: "C01_HuwelLab_Pune_01102026_08102026.eds",
      centre: PUNE,
      now: NOW,
    })
    expect(ok).toMatchObject({ passed: true, splitMode: "by_date" })
    expect(ok.artifacts).toHaveLength(2)

    const wrongRun = checkRun(setup, {
      filename: TWO_DATES,
      csvText: run(TWO_DATES),
      instrument: "quantstudio_5",
      sampleDates: ["2026-10-01", "2026-10-08"],
      composition,
      runFilename: "C01_HuwelLab_Pune_01102026.eds",
      centre: PUNE,
      now: NOW,
    })
    expect(wrongRun.passed).toBe(false)
    expect(wrongRun.issues[0]).toMatchObject({ errorCode: "FILENAME_DATE_COUNT_MISMATCH", fieldName: "runFilename" })
  })

  it("leaves single-sample runs unsplit", () => {
    const result = checkRun(multipathogen, {
      filename: ONE_SAMPLE,
      csvText: run(ONE_SAMPLE),
      instrument: "quantstudio_5",
      sampleDates: ["2026-10-01"],
      composition: SINGLE_SAMPLE,
      runFilename: "C01_HuwelLab_Pune_01102026.eds",
      centre: PUNE,
      now: NOW,
    })
    expect(result).toMatchObject({ passed: true, splitMode: "none", issues: [] })
  })

  it("refuses a composition whose samples do not fit the project's layout", () => {
    const crowded = { ...multipathogen, layout: presetLayout(multipathogen.panel, { unknownReplicates: 3, pc: 4, nc: 4 }) }
    const result = checkRun(crowded, {
      filename: TWO_DATES,
      csvText: run(TWO_DATES),
      instrument: "quantstudio_5",
      sampleDates: ["2026-10-01", "2026-10-08"],
      composition: { samples: 2, mode: "dates" },
      runFilename: "C01_HuwelLab_Pune_01102026_08102026.eds",
      centre: PUNE,
      now: NOW,
    })
    expect(result.passed).toBe(false)
    expect(result.issues.map((i) => i.errorCode)).toEqual(["PLATE_COMPOSITION_DOES_NOT_FIT"])
  })
})

describe("missing or incomplete sample identifiers block a multi-sample upload", () => {
  const COLUMNS = "Sample Name, Sample or Biological Set Name"
  const datesCsv = () => run(TWO_DATES)
  const sitesCsv = () => run(TWO_SITES)
  const dates = (csvText: string) => split(multipathogen, TWO_DATES, { csvText })
  const sites = (csvText: string) =>
    split(environmental, TWO_SITES, {
      csvText,
      layout: twoSamples(environmental, "sites"),
      instrument: "biorad_cfx96",
      centre: MUMBAI,
      sampleDates: ["2026-10-01"],
    })
  /** The single blocking issue, before any split file is made. */
  const only = (r: ReturnType<typeof dates>) => {
    expect(r.ok).toBe(false)
    const issues = r.ok ? [] : r.issues
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe("error")
    return issues[0]
  }

  it("names the columns when the export has none of them", () => {
    expect(only(dates(datesCsv().replace(",Sample Name,", ",Specimen,")))).toMatchObject({
      errorCode: "MISSING_SPLIT_IDENTIFIER_COLUMN",
      errorMessage: `This project runs 2 samples per plate (multiple dates), so the export needs each sample's collection date in a ${COLUMNS} column. None of these columns is in the file.`,
    })
    expect(only(sites(sitesCsv().replace(",Sample,Biological Set Name,", ",Specimen,Notes,"))).errorCode).toBe(
      "MISSING_SPLIT_IDENTIFIER_COLUMN"
    )
  })

  it("says what to write when the identifiers are blank or carry no date", () => {
    const blank = only(dates(datesCsv().replaceAll(",WW_01102026,", ",,").replaceAll(",WW_08102026,", ",,")))
    expect(blank.errorCode).toBe("NO_IDENTIFIER_DATES")
    expect(blank.errorMessage).toMatch(/Put each sample's date there as DDMMYY or DDMMYYYY/)
    expect(only(dates(datesCsv().replaceAll(",WW_01102026,", ",WW-A,").replaceAll(",WW_08102026,", ",WW-B,"))).errorCode).toBe(
      "NO_IDENTIFIER_DATES"
    )
    expect(only(sites(sitesCsv().replace(/,WW-(ETP|STP),(ETP|STP),/g, ",,,")))).toMatchObject({
      errorCode: "MISSING_SPLIT_IDENTIFIERS",
      errorMessage: `This project runs 2 samples per plate (multiple sites), but no sample row has a site identifier in ${COLUMNS}. Give each sample's wells the same site label (e.g. ETP, STP).`,
    })
  })

  it("lists the wells whose rows have no identifier, instead of dropping them", () => {
    expect(only(dates(datesCsv().replace(/^(5,A5,false,)WW_08102026,/gm, "$1WW-X,")))).toMatchObject({
      errorCode: "SPLIT_IDENTIFIER_MISSING",
      errorMessage: `3 sample row(s) (well A5) have no collection date in ${COLUMNS}, so they cannot be assigned to a sample.`,
    })
    expect(only(sites(sitesCsv().replace(/^(,A05,[^,]+,[^,]+,Unkn,)WW-STP,STP,/gm, "$1,,")))).toMatchObject({
      errorCode: "SPLIT_IDENTIFIER_MISSING",
      errorMessage: `3 sample row(s) (well A5) have no site identifier in ${COLUMNS}, so they cannot be assigned to a sample.`,
    })
  })

  it("says which identifiers it found when they name too few samples", () => {
    expect(only(dates(datesCsv().replaceAll(",WW_08102026,", ",WW_01102026,"))).errorMessage).toBe(
      `This project runs 2 samples per plate (multiple dates), but the collection dates in ${COLUMNS} name 1: 01/10/2026. Each sample needs its own collection date.`
    )
    expect(only(sites(sitesCsv().replaceAll("STP", "ETP"))).errorMessage).toBe(
      `This project runs 2 samples per plate (multiple sites), but the site identifiers in ${COLUMNS} name 1: ETP. Each sample needs its own site identifier.`
    )
  })

  it("accepts site identifiers in the Sample column alone", () => {
    const csv = sitesCsv().replace(",Biological Set Name,", ",Notes,").replace(/,(ETP|STP),(\d)/g, ",,$2")
    const result = sites(csv)
    expect(result.ok && result.aggregated.issues).toEqual([])
  })
})
