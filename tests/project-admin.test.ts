import { describe, expect, it } from "vitest"
import { parseAnnouncementId, parseCreateAnnouncementInput } from "../lib/announcements/schema"
import { createAnnouncement, setAnnouncementArchived } from "../lib/announcements/queries"
import type { KitSummary } from "../lib/kits/public"
import { DEFAULT_COUNTS, validateLayout } from "../lib/plate/layout"
import { assignCentreId, centreInput, createCentre, setCentreActive, updateCentre } from "../lib/project-admin/centres"
import { summariseOverview } from "../lib/project-admin/overview"
import { dbErrorMessage } from "../lib/project-admin/result"
import { changeProjectKit, detailsInput, kitChangeDefaults } from "../lib/project-admin/settings"
import { ADMIN_PAGES, isPageEnabled, visiblePages, type WorkspacePage } from "../lib/projects/features"
import { fakeSupabase } from "./fake-supabase"

const PROJECT = "10000000-0000-4000-8000-000000000001"
const CENTRE = "20000000-0000-4000-8000-000000000001"
const KIT = "50000000-0000-4000-8000-000000000001"
const ALL_ON = { data_management: true, data_compilation: true, data_plotting: true }
const MANAGEMENT_ONLY = { data_management: true, data_compilation: false, data_plotting: false }

describe("feature-gated pages", () => {
  const pages: WorkspacePage[] = [
    { page: "", label: "Overview", feature: null },
    { page: "compile", label: "Compile", feature: "data_compilation" },
    { page: "plots", label: "Plots", feature: "data_plotting" },
  ]

  it("shows only pages whose feature was switched on", () => {
    expect(visiblePages(pages, MANAGEMENT_ONLY).map((p) => p.label)).toEqual(["Overview"])
    expect(visiblePages(pages, ALL_ON).map((p) => p.label)).toEqual(["Overview", "Compile", "Plots"])
  })

  it("treats a hidden page as missing", () => {
    expect(isPageEnabled(pages, "plots", MANAGEMENT_ONLY)).toBe(false)
    expect(isPageEnabled(pages, "plots", ALL_ON)).toBe(true)
    expect(isPageEnabled(pages, "nope", ALL_ON)).toBe(false)
  })

  it("always shows the core admin pages", () => {
    const none = { data_management: false, data_compilation: false, data_plotting: false }
    expect(visiblePages(ADMIN_PAGES, none).map((p) => p.label)).toEqual([
      "Overview",
      "Centres",
      "Users",
      "Announcements",
      "Settings",
    ])
  })
})

describe("centres", () => {
  it("trims input, upper-cases the centre ID and turns blanks into nulls", () => {
    const parsed = centreInput.parse({ name: "  AIIMS  ", city: " New Delhi ", code: " c01 ", state: "", contactEmail: " Lab@AIIMS.edu " })
    expect(parsed).toEqual({ name: "AIIMS", city: "New Delhi", code: "C01", state: null, contactEmail: "lab@aiims.edu" })
    expect(centreInput.parse({ name: "A", city: "B", code: "", state: "", contactEmail: "" }).code).toBeNull()
  })

  it("rejects a blank name or city, a bad email, and centre IDs that would break file names", () => {
    const base = { name: "A", city: "B", code: "", state: "", contactEmail: "" }
    expect(centreInput.safeParse({ ...base, name: " " }).success).toBe(false)
    expect(centreInput.safeParse({ ...base, city: "" }).success).toBe(false)
    expect(centreInput.safeParse({ ...base, contactEmail: "x@" }).success).toBe(false)
    expect(centreInput.safeParse({ ...base, code: "C_01" }).success).toBe(false)
    expect(centreInput.safeParse({ ...base, code: "C 01" }).success).toBe(false)
  })

  it("gives a centre its ID only when it has none, and names a clash", async () => {
    const set = fakeSupabase({ "centres.update": { data: { code: "C01" } } })
    expect(await assignCentreId(set.client, PROJECT, CENTRE, "c01")).toEqual({ ok: true, code: "C01" })
    expect(set.calls[0].filters).toContainEqual(["is:code", null])

    const taken = fakeSupabase({ "centres.update": { data: null } })
    expect(await assignCentreId(taken.client, PROJECT, CENTRE, "C01")).toEqual({ ok: false, message: "That centre already has a centre ID." })

    const clash = fakeSupabase({
      "centres.update": { error: { code: "23505", message: 'duplicate key value violates unique constraint "idx_centres_project_code"' } },
    })
    expect(await assignCentreId(clash.client, PROJECT, CENTRE, "C01")).toEqual({
      ok: false,
      message: "Another centre in this project already has that centre ID.",
    })
    expect(await assignCentreId(clash.client, PROJECT, CENTRE, "")).toMatchObject({ ok: false })
  })

  const input = { name: "AIIMS", city: "Delhi", code: null, state: null, contactEmail: null }

  it("creates the centre in the project and explains duplicate names", async () => {
    const ok = fakeSupabase({ "centres.insert": { data: { id: CENTRE, name: "AIIMS" } } })
    expect(await createCentre(ok.client, PROJECT, input)).toEqual({ ok: true, id: CENTRE, name: "AIIMS" })
    expect(ok.calls[0].args[0]).toMatchObject({ project_id: PROJECT, name: "AIIMS" })

    const dup = fakeSupabase({ "centres.insert": { error: { code: "23505", message: "dup" } } })
    expect(await createCentre(dup.client, PROJECT, input)).toEqual({
      ok: false,
      message: "A centre with this name already exists in this project.",
    })
  })

  it("scopes edits and deactivation to the project", async () => {
    const fake = fakeSupabase({ "centres.update": { data: { id: CENTRE, name: "AIIMS" } } })
    await updateCentre(fake.client, PROJECT, CENTRE, input)
    await setCentreActive(fake.client, PROJECT, CENTRE, false)
    expect(fake.calls[1].args[0]).toEqual({ active: false })
    for (const call of fake.calls) {
      expect(call.filters).toEqual([
        ["eq:id", CENTRE],
        ["eq:project_id", PROJECT],
      ])
    }
  })

  it("reports a centre from another project as not found", async () => {
    const fake = fakeSupabase({ "centres.update": { data: null } })
    expect(await setCentreActive(fake.client, PROJECT, CENTRE, true)).toEqual({
      ok: false,
      message: "Centre not found in this project.",
    })
  })
})

describe("overview", () => {
  it("adds up centres, uploads and pending approvals", () => {
    const row = (name: string, active: boolean, uploads: number, pending: number) => ({
      centre_id: name,
      centre_name: name,
      active,
      users: 1,
      uploads_this_month: uploads,
      pending_approvals: pending,
      last_upload_at: null,
    })
    const overview = summariseOverview([row("A", true, 3, 1), row("B", true, 2, 0), row("C", false, 0, 0)], 7, "under_20")
    expect(overview).toMatchObject({
      centres: { active: 2, total: 3 },
      seats: { used: 7, limit: 20, remaining: 13 },
      uploadsThisMonth: 5,
      pendingApprovals: 1,
    })
    expect(overview.activity[2]).toMatchObject({ centreName: "C", active: false })
  })
})

describe("project details", () => {
  const base = {
    title: " Delhi AMR ",
    objective: "",
    fundingAgency: "",
    ethicsReference: "",
    startDate: "01/01/2026",
    endDate: "2026-12-31",
    frequency: "weekly",
  }

  it("accepts DD/MM/YYYY or ISO dates and stores ISO", () => {
    expect(detailsInput.parse(base)).toMatchObject({ title: "Delhi AMR", startDate: "2026-01-01", endDate: "2026-12-31" })
  })

  it("rejects an end date before the start date, bad dates and unknown frequencies", () => {
    expect(detailsInput.safeParse({ ...base, endDate: "31/12/2025" }).success).toBe(false)
    expect(detailsInput.safeParse({ ...base, startDate: "31/02/2026" }).success).toBe(false)
    expect(detailsInput.safeParse({ ...base, frequency: "daily" }).success).toBe(false)
  })
})

describe("kit change", () => {
  const kit: KitSummary = {
    id: KIT,
    name: "Test kit",
    version: "1",
    orientation: "tubes_in_rows",
    ruleDefaults: { ntc_amplification: { ct: 36 } },
    tubes: [
      { name: "T1", order: 1, targets: [{ name: "A", fluorophore: "FAM", controlType: "none", hasStdCurve: false }] },
      { name: "T2", order: 2, targets: [{ name: "B", fluorophore: "FAM", controlType: "none", hasStdCurve: false }] },
    ],
    targets: [],
    controls: [],
  }

  it("builds a valid preset layout for the new kit, keeping counts that still fit", () => {
    const counts = { unknownReplicates: 4, pc: 2, nc: 2 }
    const kept = kitChangeDefaults(kit, { version: 1, orientation: "tubes_in_columns", counts, plates: [] })
    expect(kept.plateLayout.counts).toEqual(counts)
    expect(validateLayout(kept.plateLayout, kit)).toEqual([])

    const tooMany = { unknownReplicates: 12, pc: 2, nc: 2 }
    const reset = kitChangeDefaults(kit, { version: 1, orientation: "tubes_in_rows", counts: tooMany, plates: [] })
    expect(reset.plateLayout.counts).toEqual(DEFAULT_COUNTS)
    expect(reset.qcRules.ntc_amplification?.params.ct).toBe(36)
  })

  it("refuses the current kit and bad ids without calling the database", async () => {
    const fake = fakeSupabase()
    const project = { id: PROJECT, kit_id: KIT, plate_layout: null }
    expect(await changeProjectKit(fake.client, project, KIT)).toEqual({
      ok: false,
      message: "This project already uses that kit.",
    })
    expect(await changeProjectKit(fake.client, project, "x")).toEqual({ ok: false, message: "Choose a kit." })
    expect(fake.rpc).not.toHaveBeenCalled()
  })

  it("passes the database's 'data exists' refusal through", () => {
    expect(
      dbErrorMessage({ code: "P0001", message: "The kit cannot be changed once centres have uploaded data." })
    ).toBe("The kit cannot be changed once centres have uploaded data.")
  })
})

describe("announcements", () => {
  const valid = { title: "  Upload  by   Friday ", body: "Line 1\r\nLine 2 ", audience: "all_centres", centreIds: [] }

  it("normalises the title and body", () => {
    expect(parseCreateAnnouncementInput(valid)).toEqual({
      ok: true,
      data: { title: "Upload by Friday", body: "Line 1\nLine 2", audience: "all_centres", centreIds: [] },
    })
  })

  it("requires centres for a selected audience and dedupes them", () => {
    expect(parseCreateAnnouncementInput({ ...valid, audience: "selected_centres" })).toEqual({
      ok: false,
      message: "Select at least one centre.",
    })
    const parsed = parseCreateAnnouncementInput({ ...valid, audience: "selected_centres", centreIds: [CENTRE, CENTRE] })
    expect(parsed.ok && parsed.data.centreIds).toEqual([CENTRE])
  })

  it("rejects centres with an all-centres audience, bad ids and unknown audiences", () => {
    expect(parseCreateAnnouncementInput({ ...valid, centreIds: [CENTRE] }).ok).toBe(false)
    expect(parseCreateAnnouncementInput({ ...valid, audience: "selected_centres", centreIds: ["x"] }).ok).toBe(false)
    expect(parseCreateAnnouncementInput({ ...valid, audience: "all_centers" }).ok).toBe(false)
    expect(parseAnnouncementId("nope")).toBeNull()
  })

  it("publishes through the single transactional function", async () => {
    const fake = fakeSupabase()
    fake.rpc.mockResolvedValue({ data: "ann-1", error: null })
    const result = await createAnnouncement(fake.client, PROJECT, {
      title: "T",
      body: "B",
      audience: "selected_centres",
      centreIds: [CENTRE],
    })
    expect(result).toEqual({ ok: true, id: "ann-1" })
    expect(fake.rpc).toHaveBeenCalledWith("create_announcement", {
      p_project_id: PROJECT,
      p_title: "T",
      p_body: "B",
      p_audience: "selected_centres",
      p_centre_ids: [CENTRE],
    })
  })

  it("archives only within the project", async () => {
    const fake = fakeSupabase({ "announcements.update": { data: null } })
    expect(await setAnnouncementArchived(fake.client, PROJECT, CENTRE, true)).toEqual({
      ok: false,
      message: "Announcement not found in this project.",
    })
    expect(fake.calls[0].filters).toContainEqual(["eq:project_id", PROJECT])
  })
})
