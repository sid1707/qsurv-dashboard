import { readFileSync } from "node:fs"
import path from "node:path"
import type { PGlite } from "@electric-sql/pglite"
import { beforeAll, describe, expect, it } from "vitest"
import { DEFAULT_COUNTS, presetLayout, type PlateLayout } from "../lib/plate/layout"
import { defaultRuleSettings, type RuleSettings } from "../lib/rules/catalog"
import { validateRunExport, type RunValidationInput } from "../lib/validation/engine"
import { parseUploadFilename, validateRunfile, validateUploadFilename, type CentreFileIdentity } from "../lib/validation/filename"
import type { KitTargetRow } from "../lib/validation/kit"
import { normaliseWell } from "../lib/validation/rows"
import { buildValidationSetup, type ValidationSetup } from "../lib/validation/setup"
import { createMigratedDb } from "./db/harness"

const RUNS = path.resolve(__dirname, "fixtures/runs")
const run = (name: string) => readFileSync(path.join(RUNS, name), "utf8")

const QS5_OK = "C01_HuwelLab_Pune_01102026_quantstudio5.csv"
const QS5_WRONG_LAYOUT = "C01_HuwelLab_Pune_01102026_quantstudio5_wrong-layout.csv"
const CFX_OK = "C02_EnvLab_Mumbai_01102026_cfx96.csv"
const NOW = new Date("2026-10-05T00:00:00Z")
// Centres as the database names them: ID from the admin, code from name and city.
const PUNE: CentreFileIdentity = { centreId: "C01", fileCode: "HuwelLab_Pune" }
const MUMBAI: CentreFileIdentity = { centreId: "C02", fileCode: "EnvLab_Mumbai" }
const centreFor = (filename: string) => (filename.startsWith("C02") ? MUMBAI : PUNE)

let db: PGlite
let multipathogen: ValidationSetup
let environmental: ValidationSetup

/** Loads a kit and its targets from the migrated database, as the app does. */
async function setupFromDb(kitName: string, project: { plate_layout: unknown; qc_rules: unknown }) {
  const { rows } = await db.query<{ kit: never }>(
    `select jsonb_build_object(
       'id', k.id, 'name', k.name, 'version', k.version, 'layout_orientation', k.layout_orientation,
       'rule_defaults', k.rule_defaults,
       'kit_targets', (select jsonb_agg(to_jsonb(t)) from public.kit_targets t where t.kit_id = k.id)
     ) as kit
     from public.kits k where k.name = $1`,
    [kitName]
  )
  return buildValidationSetup(rows[0].kit, project)
}

function check(setup: ValidationSetup, filename: string, overrides: Partial<RunValidationInput> = {}) {
  return validateRunExport({
    filename,
    csvText: run(filename),
    kit: setup.kit,
    layout: setup.layout,
    rules: setup.rules,
    instrument: "quantstudio_5",
    sampleDates: ["2026-10-01"],
    centre: centreFor(filename),
    now: NOW,
    ...overrides,
  })
}

const codes = (result: { issues: { errorCode: string }[] }) => result.issues.map((i) => i.errorCode)

beforeAll(async () => {
  db = await createMigratedDb()
  // A project stores the layout drawn at onboarding; the preset is what the form starts from.
  multipathogen = await setupFromDb("Huwel Multipathogen", { plate_layout: null, qc_rules: null })
  environmental = await setupFromDb("Huwel Environmental Surveillance", { plate_layout: null, qc_rules: null })
}, 60_000)

describe("placeholder kits from kit_targets", () => {
  it("builds the panel, aliases, dyes and Ct cut-offs from the database rows", () => {
    expect(multipathogen.kit.targets.map((t) => [t.name, t.fluorophoreLabel, t.ctMin])).toEqual([
      ["Target A", "FAM", 12],
      ["Target B", "HEX", 12],
      ["Internal Control", "Cy5", 18],
    ])
    expect(multipathogen.kit.resolve("tgt-a")?.name).toBe("Target A")
    expect(environmental.kit.resolve("TGT-Y")?.name).toBe("Target Y")
    // No plate layout stored: the kit's preset (A1-A3 samples, A4 PC, A5 NTC).
    expect(multipathogen.layout.plates[0]).toMatchObject({
      A1: { role: "unknown" },
      A4: { role: "pc" },
      A5: { role: "nc" },
    })
  })
})

describe("valid runs", () => {
  it("passes a QuantStudio 5 export for Huwel Multipathogen", () => {
    const result = check(multipathogen, QS5_OK)
    expect(result.issues).toEqual([])
    expect(result.passed).toBe(true)
    expect(result.details).toContain("Export format: QuantStudio 5.")
  })

  it("passes a Bio-Rad CFX96 export (A01 wells, Content column, NaN Cq) for Huwel Environmental Surveillance", () => {
    const result = check(environmental, CFX_OK, { instrument: "biorad_cfx96" })
    expect(result.issues).toEqual([])
    expect(result.passed).toBe(true)
    expect(result.details).toContain("Export format: Bio-Rad CFX96.")
  })

  it("accepts any export format when the project's instrument is Other", () => {
    expect(check(environmental, CFX_OK, { instrument: "other" }).passed).toBe(true)
  })
})

describe("plate layout", () => {
  it("rejects a run whose control wells are not where the layout puts them", () => {
    const result = check(multipathogen, QS5_WRONG_LAYOUT)
    expect(result.passed).toBe(false)
    const layoutIssues = result.issues.filter((i) => i.errorCode === "WRONG_WELL_ROLE")
    expect(layoutIssues.map((i) => i.well)).toEqual(["A1", "A2", "A4", "A5"])
    expect(layoutIssues[0].errorMessage).toBe(
      "Well A1 is a sample in the plate layout but the file marks it as a positive control."
    )
    // Counts per role are still right; only the positions are wrong.
    expect(codes(result)).not.toContain("MISSING_REPLICATES")
  })

  it("rejects a run loaded in a row the layout leaves empty", () => {
    const shifted = run(QS5_OK).replace(/^(\d+),A(\d+),/gm, (_m, n, col) => `${Number(n) + 12},B${col},`)
    const result = validateRunExport({ ...input(multipathogen, QS5_OK), csvText: shifted })
    expect(result.passed).toBe(false)
    expect(result.issues.filter((i) => i.errorCode === "WELL_NOT_IN_LAYOUT").map((i) => i.well)).toEqual([
      "B1",
      "B2",
      "B3",
      "B4",
      "B5",
    ])
  })

  it("rejects a tube read in another tube's wells", () => {
    const layout: PlateLayout = {
      ...multipathogen.layout,
      plates: [{ ...multipathogen.layout.plates[0], A2: { tube: "Tube 2", role: "unknown" } }],
    }
    const result = check(multipathogen, QS5_OK, { layout })
    expect(result.issues.find((i) => i.errorCode === "WRONG_WELL_TARGET")?.errorMessage).toBe(
      "Well A2 should hold Tube 2 but reports Target A."
    )
  })

  it("summarises a badly shifted plate instead of listing every well", () => {
    const layout: PlateLayout = { ...multipathogen.layout, plates: [{}] }
    const result = check(multipathogen, QS5_OK, { layout })
    const layoutIssues = result.issues.filter((i) => i.fieldName === "Well Position")
    expect(layoutIssues.length).toBeLessThanOrEqual(12)
    expect(codes(result)).toContain("WELL_NOT_IN_LAYOUT")
  })

  it("is skipped when the project switched the rule off", () => {
    const rules: RuleSettings = { ...multipathogen.rules, plate_layout: { enabled: false, params: {} } }
    expect(check(multipathogen, QS5_WRONG_LAYOUT, { rules }).passed).toBe(true)
  })

  it("uses the layout's roles when the export has no Task or Content column", () => {
    const noTask = run(QS5_OK).replace(/,Task,/, ",Step,")
    const result = validateRunExport({ ...input(multipathogen, QS5_OK), csvText: noTask })
    expect(result.passed).toBe(true)
  })
})

function input(setup: ValidationSetup, filename: string): RunValidationInput {
  return {
    filename,
    csvText: run(filename),
    kit: setup.kit,
    layout: setup.layout,
    rules: setup.rules,
    instrument: "quantstudio_5",
    sampleDates: ["2026-10-01"],
    centre: centreFor(filename),
    now: NOW,
  }
}

function edited(setup: ValidationSetup, filename: string, edit: (csv: string) => string, overrides: Partial<RunValidationInput> = {}) {
  return validateRunExport({ ...input(setup, filename), csvText: edit(run(filename)), ...overrides })
}

describe("kit-driven checks", () => {
  it("accepts aliases from kit_targets and rejects targets outside the kit", () => {
    expect(edited(multipathogen, QS5_OK, (csv) => csv.replaceAll(",Target A,", ",TGT-A,")).passed).toBe(true)

    const result = edited(multipathogen, QS5_OK, (csv) => csv.replaceAll(",Target A,", ",Target Z,"))
    expect(codes(result)).toContain("UNKNOWN_TARGET")
    expect(result.issues.find((i) => i.errorCode === "MISSING_PANEL_TARGETS")?.errorMessage).toBe(
      "CSV must include all 3 panel targets. Missing: Target A."
    )
  })

  it("checks each target's dye against the kit", () => {
    const result = edited(multipathogen, QS5_OK, (csv) => csv.replace(",Target B,UNKNOWN,HEX,", ",Target B,UNKNOWN,FAM,"))
    const issue = result.issues.find((i) => i.errorCode === "FLUOROPHORE_TARGET_MISMATCH")
    expect(issue).toMatchObject({ rowNumber: 9, well: "A1", targetName: "Target B" })
    expect(issue?.errorMessage).toBe("Target 'Target B' has fluorophore 'FAM' but expected HEX.")
  })

  it("warns on Ct below the target's kit_targets.ct_min", () => {
    const result = edited(multipathogen, QS5_OK, (csv) => csv.replace(",Target A,UNKNOWN,FAM,NFQ-MGB,24.512", ",Target A,UNKNOWN,FAM,NFQ-MGB,11.5"))
    expect(result.passed).toBe(true)
    const warning = result.issues.find((i) => i.errorCode === "LOW_CT_THRESHOLD")
    expect(warning?.errorMessage).toContain("Row 8 (A1): Target A Ct=11.50 (cutoff 12)")
  })

  it("warns when an NTC amplifies at or below the project's cut-off", () => {
    const result = edited(multipathogen, QS5_OK, (csv) => csv.replace(",Target A,NTC,FAM,NFQ-MGB,Undetermined", ",Target A,NTC,FAM,NFQ-MGB,30.1"))
    expect(result.passed).toBe(true)
    expect(result.issues).toEqual([
      expect.objectContaining({ errorCode: "NTC_AMPLIFIED", severity: "warning", errorMessage: "NTC (Target A) shows amplification Ct=30.10.", well: "A5" }),
    ])
  })

  it("needs positive and negative controls, with the layout's replicate counts", () => {
    const result = edited(multipathogen, QS5_OK, (csv) => csv.split("\n").filter((l) => !l.includes(",A5,")).join("\n"))
    expect(codes(result)).toEqual(expect.arrayContaining(["MISSING_NTC_ROWS", "MISSING_REPLICATES"]))
    expect(result.issues.find((i) => i.errorCode === "MISSING_REPLICATES")?.errorMessage).toBe(
      "Replicates for target Target A do not match the plate layout. Expected 3 unknown replicates, 1 pos ctrl and 1 neg ctrl. Observed unknown replicates=3, pos ctrl=1, neg ctrl=0."
    )
  })

  it("needs the required columns", () => {
    const result = edited(multipathogen, QS5_OK, (csv) => csv.replace(",Reporter,", ",Dye Name,"))
    expect(result).toMatchObject({ passed: false, issues: [expect.objectContaining({ errorCode: "MISSING_REQUIRED_COLUMN", fieldName: "Fluor" })] })
  })
})

describe("instrument", () => {
  it("rejects an export from a different instrument than the upload is for", () => {
    const result = check(environmental, CFX_OK, { instrument: "quantstudio_5" })
    expect(result.issues[0]).toMatchObject({ errorCode: "INSTRUMENT_MISMATCH" })
    expect(result.issues[0].errorMessage).toMatch(/Bio-Rad CFX96 export, but the upload is for QuantStudio 5/)
  })

  it("requires the instrument's own run file, named for the same centre and dates", () => {
    const dates = ["2026-10-01"]
    expect(validateRunfile(QS5_OK, "C01_HuwelLab_Pune_011026.eds", "quantstudio_5", PUNE, dates)).toEqual([])
    expect(validateRunfile(CFX_OK, "C02_EnvLab_Mumbai_01102026 - run 2.pcrd", "biorad_cfx96", MUMBAI, dates)).toEqual([])
    expect(validateRunfile(QS5_OK, "C01_HuwelLab_Pune_01102026.pcrd", "quantstudio_5", PUNE, dates)[0].errorCode).toBe("RUNFILE_EXTENSION")
    expect(validateRunfile(QS5_OK, "C01_HuwelLab_Pune_02102026.eds", "quantstudio_5", PUNE, dates)[0]).toMatchObject({
      errorCode: "FILENAME_DATE_MISMATCH",
      fieldName: "runFilename",
    })
    expect(validateRunfile(QS5_OK, "plate7.eds", "quantstudio_5", PUNE, dates)[0].errorCode).toBe("CENTRE_ID_MISMATCH")
    expect(validateRunfile(QS5_OK, null, "other")[0].errorCode).toBe("RUNFILE_REQUIRED")
  })

  it("reads A1, A01 and numeric QuantStudio wells", () => {
    expect(["A1", "a01", "H12", "13", "96", "Z1", "97", ""].map(normaliseWell)).toEqual(["A1", "A1", "H12", "B1", "H12", null, null, null])
  })
})

describe("file name: <Centre ID>_<Name>_<Location>_<DDMMYY>", () => {
  const dates = ["2026-10-01"]
  const errorCode = (name: string, sampleDates = dates) => validateUploadFilename(name, PUNE, sampleDates, NOW)[0]?.errorCode

  it("only takes .csv results exports", () => {
    expect(errorCode("C01_HuwelLab_Pune_01102026.xlsx")).toBe("UNSUPPORTED_FILE_EXTENSION")
  })

  it("accepts the centre's own name with DDMMYY or DDMMYYYY, any case, and junk after the dates", () => {
    for (const ok of [
      "C01_HuwelLab_Pune_011026.csv",
      "c01_huwellab_pune_01102026.csv",
      "C01_HuwelLab_Pune_01102026_Results.csv",
      "C01_HuwelLab_Pune_01102026 - Quantification Cq Results.csv",
    ]) {
      expect(validateUploadFilename(ok, PUNE, dates, NOW), ok).toEqual([])
    }
  })

  it("names what is wrong with the centre ID, centre code or date", () => {
    expect(errorCode("C02_HuwelLab_Pune_01102026.csv")).toBe("CENTRE_ID_MISMATCH")
    expect(errorCode("C01_Huwel_Pune_01102026.csv")).toBe("CENTRE_CODE_MISMATCH")
    expect(errorCode("C01_HuwelLab_Pune.csv")).toBe("INVALID_FILENAME_FORMAT")
    expect(errorCode("C01_HuwelLab_Pune_31022026.csv")).toBe("INVALID_FILENAME_FORMAT")
    expect(errorCode("C01_HuwelLab_Pune_02102026.csv")).toBe("FILENAME_DATE_MISMATCH")
    expect(errorCode("C01_HuwelLab_Pune_01122026.csv")).toBe("FILENAME_DATE_FUTURE")
    expect(validateUploadFilename("C02_x_01102026.csv", PUNE, dates, NOW)[0].errorMessage).toBe(
      "File name starts with 'C02' but your centre ID is C01. Expected C01_HuwelLab_Pune_DDMMYY.csv."
    )
  })

  it("needs every date of a multi-date plate, in any order", () => {
    const two = ["2026-10-01", "2026-10-08"]
    expect(errorCode("C01_HuwelLab_Pune_08102026_01102026.csv", two)).toBeUndefined()
    expect(errorCode("C01_HuwelLab_Pune_01102026.csv", two)).toBe("FILENAME_DATE_COUNT_MISMATCH")
    expect(errorCode("C01_HuwelLab_Pune_01102026_09102026.csv", two)).toBe("FILENAME_DATE_MISMATCH")
  })

  it("cannot be checked before the admin gives the centre an ID", () => {
    expect(validateUploadFilename(QS5_OK, { centreId: null, fileCode: "HuwelLab_Pune" }, dates, NOW)[0].errorCode).toBe(
      "CENTRE_ID_MISSING"
    )
  })

  it("reads the prefix as written and the dates in order", () => {
    expect(parseUploadFilename("c01_HuwelLab_pune_011026_08102026_x.csv", PUNE)).toEqual({
      ok: true,
      name: { prefix: "c01_HuwelLab_pune", dates: ["2026-10-01", "2026-10-08"] },
    })
  })
})

describe("internal controls (kit with exogenous and endogenous controls)", () => {
  const rows: KitTargetRow[] = [
    { target_name: "Norovirus", aliases: [], fluorophore: "FAM", control_type: "none", ct_min: null, ct_max: 38, tube_name: "Noro", tube_order: 1, sort_order: 1 },
    { target_name: "IC", aliases: ["MS2"], fluorophore: "Texas Red/ROX", control_type: "exogenous_control", ct_min: null, ct_max: 35, tube_name: "Noro", tube_order: 1, sort_order: 2 },
    { target_name: "PMMoV", aliases: [], fluorophore: "VIC/HEX", control_type: "endogenous_control", ct_min: null, ct_max: 35, tube_name: "Noro", tube_order: 1, sort_order: 3 },
  ]
  const kitRow = { id: "k", name: "WWS test", version: "1", layout_orientation: "tubes_in_rows", rule_defaults: {}, kit_targets: rows.map((r) => ({ ...r, std_slope: null })) }
  const setup = buildValidationSetup(kitRow, { plate_layout: null, qc_rules: null })

  function cfxRun(ct: { noro: string; ic: string; pmmov: string }) {
    const lines = [",Well,Fluor,Target,Content,Sample,Cq"]
    const wells: [string, string][] = [["A01", "Unkn"], ["A02", "Unkn"], ["A03", "Unkn"], ["A04", "Pos Ctrl"], ["A05", "NTC"]]
    for (const [well, content] of wells) {
      const nc = content === "NTC"
      lines.push(`,${well},FAM,Norovirus,${content},S,${nc ? "NaN" : ct.noro}`)
      lines.push(`,${well},Texas Red,MS2,${content},S,${nc ? "NaN" : ct.ic}`)
      lines.push(`,${well},HEX,PMMoV,${content},S,${nc ? "NaN" : ct.pmmov}`)
    }
    return lines.join("\n")
  }

  const validate = (csvText: string) =>
    validateRunExport({ filename: "wws.csv", csvText, centre: null, kit: setup.kit, layout: setup.layout, rules: setup.rules, instrument: "biorad_cfx96", now: NOW })

  it("passes when both controls behave, accepting any dye listed for the target", () => {
    expect(validate(cfxRun({ noro: "30", ic: "28", pmmov: "25" })).issues).toEqual([])
  })

  it("warns when the exogenous control does not amplify, or the endogenous control mean Ct is high", () => {
    const result = validate(cfxRun({ noro: "30", ic: "36.5", pmmov: "36" }))
    expect(result.passed).toBe(true)
    // Priority warnings (endogenous Ct) come before the others.
    expect(codes(result)).toEqual(["ENDOGENOUS_CT_HIGH", "EXOGENOUS_NOT_AMPLIFIED"])
    expect(result.issues[0].errorMessage).toMatch(/^Mean PMMoV Ct is 36.00 \(cutoff 35\)/)
  })

  it("requires both controls in the file", () => {
    const result = validate(cfxRun({ noro: "30", ic: "28", pmmov: "25" }).replaceAll(",PMMoV,", ",Unlisted,"))
    expect(codes(result)).toEqual(expect.arrayContaining(["MISSING_ENDOGENOUS_CONTROL", "UNKNOWN_TARGET"]))
  })
})

describe("multi-plate layouts", () => {
  const rows: KitTargetRow[] = ["T1", "T2"].map((tube, i) => ({
    target_name: `Gene ${i + 1}`,
    aliases: [],
    fluorophore: "FAM",
    control_type: "none",
    ct_min: null,
    ct_max: null,
    tube_name: tube,
    tube_order: i + 1,
    sort_order: i + 1,
  }))
  const kitRow = { id: "k", name: "Two plates", version: "1", layout_orientation: "tubes_in_rows", rule_defaults: {}, kit_targets: rows.map((r) => ({ ...r, std_slope: null })) }
  // One tube per plate, both in row A.
  const base = buildValidationSetup(kitRow, { plate_layout: null, qc_rules: null })
  const preset = presetLayout(base.panel, DEFAULT_COUNTS)
  const layout: PlateLayout = {
    ...preset,
    plates: [
      Object.fromEntries(Object.entries(preset.plates[0]).filter(([, w]) => w.tube === "T1")),
      Object.fromEntries(Object.entries(preset.plates[0]).filter(([, w]) => w.tube === "T2").map(([well, w]) => [well.replace(/^B/, "A"), w])),
    ],
  }
  const rules = defaultRuleSettings(base.panel, "qc")

  it("matches the export to the plate it belongs to and only needs that plate's targets", () => {
    const csv = [",Well,Fluor,Target,Content,Sample,Cq", ...["A01 Unkn", "A02 Unkn", "A03 Unkn", "A04 Pos Ctrl", "A05 NTC"].map((w) => {
      const [well, ...content] = w.split(" ")
      return `,${well},FAM,Gene 2,${content.join(" ")},S,${content[0] === "NTC" ? "NaN" : "25"}`
    })].join("\n")
    const result = validateRunExport({ filename: "p2.csv", csvText: csv, centre: null, kit: base.kit, layout, rules, instrument: "biorad_cfx96", now: NOW })
    expect(result.issues).toEqual([])
    expect(result.details).toContain("Matched plate 2 of 2 in the plate layout.")
  })
})
