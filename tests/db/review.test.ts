import type { PGlite } from "@electric-sql/pglite"
import { beforeAll, describe, expect, it } from "vitest"
import { createMigratedDb, runAs } from "./harness"

const SUPER = "00000000-0000-4000-8000-0000000000a1"
const PROJECT_ADMIN = "00000000-0000-4000-8000-0000000000a2"
const REQUESTER = "00000000-0000-4000-8000-0000000000a3"
const REQUESTER_2 = "00000000-0000-4000-8000-0000000000a4"
const BAN = "2126-01-01T00:00:00Z"

let db: PGlite
let kitId: string

async function createRequester(id: string) {
  await db.query(
    "insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, banned_until) values ($1, $2, $3, $4, $5)",
    [id, `${id.slice(-4)}@example.org`, '{"full_name":"Requester"}', '{"qsurv_status":"pending_approval"}', BAN]
  )
}

const LAYOUT = {
  version: 1,
  orientation: "tubes_in_rows",
  counts: { unknownReplicates: 3, pc: 1, nc: 1 },
  plates: [{ A1: { tube: "NVK", role: "unknown" } }],
}
const QC_RULES = { ntc_amplification: { enabled: true, params: { ct: 38 } } }
const COMPILE_RULES = { outlier_removal: { enabled: false, params: { maxSd: 5, minReplicates: 2 } } }

async function createRequest(options: { user: string; code: string; centres?: unknown[] }) {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.project_requests (
       requester_user_id, requester_name, requester_email, institution_name, city, state,
       project_title, requested_code, objective, start_date, end_date, sample_type, frequency,
       kit_id, instruments, user_tier, data_management, data_compilation, data_plotting,
       proposed_centres, funding_agency, consent_accepted_at, plate_layout, qc_rules, compile_rules)
     values ($1, 'Requester', 'r@example.org', 'Lab', 'Pune', 'MH',
       'Wastewater AMR', $2, 'Objective', null, null, 'wastewater', 'weekly',
       $3, array['quantstudio_5', 'biorad_cfx96'], 'under_20', true, true, false,
       $4, 'DBT', now(), $5, $6, $7)
     returning id`,
    [
      options.user,
      options.code,
      kitId,
      JSON.stringify(options.centres ?? []),
      JSON.stringify(LAYOUT),
      JSON.stringify(QC_RULES),
      JSON.stringify(COMPILE_RULES),
    ]
  )
  return rows[0].id
}

function asSuper<T>(sql: string, params: unknown[] = []) {
  return runAs(db, "authenticated", SUPER, (tx) => tx.query<T>(sql, params))
}

async function count(sql: string, params: unknown[] = []) {
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from (${sql}) s`, params)
  return rows[0].n
}

beforeAll(async () => {
  db = await createMigratedDb()
  await db.query("insert into auth.users (id, email) values ($1, 'super@example.org'), ($2, 'admin@example.org')", [
    SUPER,
    PROJECT_ADMIN,
  ])
  await db.query("update public.profiles set is_super_admin = true where user_id = $1", [SUPER])
  kitId = (await db.query<{ id: string }>("select id from public.kits order by name limit 1")).rows[0].id
}, 60_000)

// runAs rolls back, so approvals that should persist across assertions run as
// the super admin inside one transaction and return everything needed.
describe("approve_project_request", () => {
  it("creates the project, centres and admin membership, unblocks the login and audits it, in one go", async () => {
    await createRequester(REQUESTER)
    const requestId = await createRequest({
      user: REQUESTER,
      code: "WW-PUNE",
      centres: [
        { name: "Centre A", city: "Pune", contact_email: "A@Example.org" },
        { name: " centre a ", city: "", contact_email: null },
        { name: "Centre B", city: null, contact_email: null },
        { name: "", city: "Nowhere", contact_email: null },
      ],
    })

    const outcome = await runAs(db, "authenticated", SUPER, async (tx) => {
      const result = await tx.query<{ r: { project_id: string; centres_created: number } }>(
        "select public.approve_project_request($1, 'Looks good') as r",
        [requestId]
      )
      const projectId = result.rows[0].r.project_id
      const q = async <T>(sql: string) => (await tx.query<T>(sql, [projectId])).rows
      return {
        result: result.rows[0].r,
        project: (await q<Record<string, unknown>>("select * from public.projects where id = $1"))[0],
        centres: await q<{ name: string; city: string | null; contact_email: string | null }>(
          "select name, city, contact_email from public.centres where project_id = $1 order by name"
        ),
        memberships: await q<{ user_id: string; role: string; centre_id: string | null }>(
          "select user_id, role, centre_id from public.project_memberships where project_id = $1"
        ),
        audit: await q<{ event_type: string; actor_user_id: string; payload: Record<string, unknown> }>(
          "select event_type, actor_user_id, payload from public.audit_events where project_id = $1"
        ),
        request: (
          await tx.query<{ status: string; reviewed_by: string; review_note: string }>(
            "select status, reviewed_by, review_note from public.project_requests where id = $1",
            [requestId]
          )
        ).rows[0],
      }
    })

    expect(outcome.result.centres_created).toBe(2)
    expect(outcome.project).toMatchObject({
      code: "WW-PUNE",
      title: "Wastewater AMR",
      kit_id: kitId,
      sample_type: "wastewater",
      frequency: "weekly",
      start_date: null,
      end_date: null,
      instruments: ["quantstudio_5", "biorad_cfx96"],
      plate_layout: LAYOUT,
      qc_rules: QC_RULES,
      compile_rules: COMPILE_RULES,
      user_tier: "under_20",
      funding_agency: "DBT",
      data_management: true,
      data_compilation: true,
      data_plotting: false,
      status: "active",
      request_id: requestId,
    })
    expect(outcome.centres).toEqual([
      { name: "Centre A", city: "Pune", contact_email: "a@example.org" },
      { name: "Centre B", city: null, contact_email: null },
    ])
    expect(outcome.memberships).toEqual([{ user_id: REQUESTER, role: "project_admin", centre_id: null }])
    expect(outcome.audit).toHaveLength(1)
    expect(outcome.audit[0]).toMatchObject({
      event_type: "project_request.approved",
      actor_user_id: SUPER,
      payload: { project_code: "WW-PUNE", centres_created: 2 },
    })
    expect(outcome.request).toEqual({ status: "approved", reviewed_by: SUPER, review_note: "Looks good" })
  })

  it("unblocks the admin's login", async () => {
    await createRequester(REQUESTER_2)
    const requestId = await createRequest({ user: REQUESTER_2, code: "UNBAN-ME" })
    const user = await runAs(db, "authenticated", SUPER, async (tx) => {
      await tx.query("select public.approve_project_request($1)", [requestId])
      // auth.users is not readable by API roles, so check it as the table owner.
      await tx.exec("reset role")
      return (
        await tx.query<{ banned_until: string | null; raw_app_meta_data: Record<string, unknown> }>(
          "select banned_until, raw_app_meta_data from auth.users where id = $1",
          [REQUESTER_2]
        )
      ).rows[0]
    })
    expect(user.banned_until).toBeNull()
    expect(user.raw_app_meta_data).toMatchObject({ qsurv_status: "approved" })
  })

  it("changes nothing when any step fails (short code already used by a project)", async () => {
    const requestId = await createRequest({ user: REQUESTER_2, code: "TAKEN-CODE" })
    await db.query(
      "insert into public.projects (code, title, sample_type, frequency, kit_id) values ('TAKEN-CODE', 'Existing', 'clinical', 'monthly', $1)",
      [kitId]
    )

    await expect(asSuper("select public.approve_project_request($1)", [requestId])).rejects.toThrow(
      /already used by another project/
    )
    expect(await count("select 1 from public.projects where request_id = $1", [requestId])).toBe(0)
    expect(await count("select 1 from public.project_requests where id = $1 and status = 'pending'", [requestId])).toBe(1)
    expect(await count("select 1 from auth.users where id = $1 and banned_until is not null", [REQUESTER_2])).toBe(1)
    expect(await count("select 1 from public.audit_events where entity_id = $1", [requestId])).toBe(0)
  })

  it("rolls back the project and centres if the membership cannot be created", async () => {
    const ghost = "00000000-0000-4000-8000-0000000000ff"
    await db.query("insert into auth.users (id, email) values ($1, 'ghost@example.org')", [ghost])
    // Remove the profile so the membership insert fails after the project and centres exist.
    await db.query("delete from public.profiles where user_id = $1", [ghost])
    const requestId = await createRequest({
      user: ghost,
      code: "GHOST",
      centres: [{ name: "Centre X", city: null, contact_email: null }],
    })

    await expect(asSuper("select public.approve_project_request($1)", [requestId])).rejects.toThrow()
    expect(await count("select 1 from public.projects where code = 'GHOST'")).toBe(0)
    expect(await count("select 1 from public.centres where name = 'Centre X'")).toBe(0)
    expect(await count("select 1 from public.project_requests where id = $1 and status = 'pending'", [requestId])).toBe(1)
  })

  it("only lets a super admin approve", async () => {
    const requestId = await createRequest({ user: REQUESTER_2, code: "NOT-YOURS" })
    for (const [role, user] of [
      ["authenticated", PROJECT_ADMIN],
      ["authenticated", REQUESTER_2],
    ] as const) {
      await expect(
        runAs(db, role, user, (tx) => tx.query("select public.approve_project_request($1)", [requestId]))
      ).rejects.toThrow(/Only a super admin/)
    }
    await expect(
      runAs(db, "anon", null, (tx) => tx.query("select public.approve_project_request($1)", [requestId]))
    ).rejects.toThrow(/permission denied/)
  })

  it("refuses a request that is not pending", async () => {
    const requestId = await createRequest({ user: REQUESTER_2, code: "DONE-ONCE" })
    await db.query(
      "update public.project_requests set status = 'rejected', reviewed_at = now(), review_note = 'no' where id = $1",
      [requestId]
    )
    await expect(asSuper("select public.approve_project_request($1)", [requestId])).rejects.toThrow(
      /already been rejected/
    )
  })
})

describe("reject_project_request", () => {
  it("rejects with a reason, keeps the login blocked and audits it", async () => {
    const requestId = await createRequest({ user: REQUESTER_2, code: "REJECT-ME" })
    const outcome = await runAs(db, "authenticated", SUPER, async (tx) => {
      await tx.query("select public.reject_project_request($1, '  Out of scope  ')", [requestId])
      const request = (
        await tx.query<{ status: string; review_note: string; reviewed_by: string }>(
          "select status, review_note, reviewed_by from public.project_requests where id = $1",
          [requestId]
        )
      ).rows[0]
      const audit = (
        await tx.query<{ event_type: string; project_id: string | null; payload: Record<string, unknown> }>(
          "select event_type, project_id, payload from public.audit_events where entity_id = $1",
          [requestId]
        )
      ).rows
      await tx.exec("reset role")
      const user = (
        await tx.query<{ banned_until: string | null }>("select banned_until from auth.users where id = $1", [
          REQUESTER_2,
        ])
      ).rows[0]
      const projects = (await tx.query("select 1 from public.projects where code = 'REJECT-ME'")).rows
      return { request, audit, user, projects }
    })

    expect(outcome.request).toEqual({ status: "rejected", review_note: "Out of scope", reviewed_by: SUPER })
    expect(outcome.audit).toEqual([
      { event_type: "project_request.rejected", project_id: null, payload: expect.objectContaining({ reason: "Out of scope" }) },
    ])
    expect(outcome.user.banned_until).not.toBeNull()
    expect(outcome.projects).toEqual([])
  })

  it.each(["", "   ", null])("requires a reason (%o)", async (reason) => {
    const requestId = await createRequest({ user: REQUESTER_2, code: `NO-REASON-${String(reason).length}` })
    await expect(asSuper("select public.reject_project_request($1, $2)", [requestId, reason])).rejects.toThrow(
      /reason is required/
    )
  })

  it("only lets a super admin reject", async () => {
    const requestId = await createRequest({ user: REQUESTER_2, code: "KEEP-PENDING" })
    await expect(
      runAs(db, "authenticated", PROJECT_ADMIN, (tx) =>
        tx.query("select public.reject_project_request($1, 'no')", [requestId])
      )
    ).rejects.toThrow(/Only a super admin/)
  })

  it("refuses a request that is not pending", async () => {
    await createRequester("00000000-0000-4000-8000-0000000000b1")
    const requestId = await createRequest({ user: "00000000-0000-4000-8000-0000000000b1", code: "APPROVED-FIRST" })
    await expect(
      runAs(db, "authenticated", SUPER, async (tx) => {
        await tx.query("select public.approve_project_request($1)", [requestId])
        await tx.query("select public.reject_project_request($1, 'changed my mind')", [requestId])
      })
    ).rejects.toThrow(/already been approved/)
  })
})

describe("save_kit", () => {
  const target = (overrides: Record<string, unknown> = {}) => ({
    target_name: "Target 1",
    aliases: ["T1"],
    fluorophore: "FAM",
    channel: "Green",
    plate_wells: ["A1", "B1"],
    control_type: "none",
    ct_min: 12,
    ct_max: 38,
    sort_order: 1,
    ...overrides,
  })

  it("creates a kit with targets, then updates, adds and removes targets in one call", async () => {
    const result = await runAs(db, "authenticated", SUPER, async (tx) => {
      const created = await tx.query<{ id: string }>("select public.save_kit($1, $2) as id", [
        { name: "Test Kit", version: "1.0", active: true },
        [target(), target({ target_name: "Target 2", fluorophore: "HEX", sort_order: 2 })],
      ])
      const kit = created.rows[0].id
      const before = (
        await tx.query<{ id: string; target_name: string }>(
          "select id, target_name from public.kit_targets where kit_id = $1 order by sort_order",
          [kit]
        )
      ).rows

      await tx.query("select public.save_kit($1, $2)", [
        { id: kit, name: "Test Kit", version: "1.1", active: false },
        [
          target({ id: before[0].id, target_name: "Target 1 renamed", plate_wells: ["C3"], ct_max: 35 }),
          target({ target_name: "IC", fluorophore: "Cy5", control_type: "internal_control", sort_order: 3 }),
        ],
      ])
      return {
        kit: (await tx.query("select name, version, active from public.kits where id = $1", [kit])).rows[0],
        targets: (
          await tx.query(
            "select id, target_name, plate_wells, control_type, ct_max::float as ct_max from public.kit_targets where kit_id = $1 order by sort_order",
            [kit]
          )
        ).rows,
        firstId: before[0].id,
      }
    })

    expect(result.kit).toEqual({ name: "Test Kit", version: "1.1", active: false })
    expect(result.targets).toEqual([
      { id: result.firstId, target_name: "Target 1 renamed", plate_wells: ["C3"], control_type: "none", ct_max: 35 },
      expect.objectContaining({ target_name: "IC", control_type: "internal_control" }),
    ])
  })

  it("saves tubes, layout orientation and standard curves", async () => {
    const result = await runAs(db, "authenticated", SUPER, async (tx) => {
      const created = await tx.query<{ id: string }>("select public.save_kit($1, $2) as id", [
        { name: "Tube Kit", version: "1", active: true, layout_orientation: "tubes_in_columns" },
        [
          target({ tube_name: "PPM 1", tube_order: 1, std_slope: -3.3, std_intercept: 40, pc_copies: 2000000 }),
          target({ target_name: "Target 2", tube_name: "PPM 2", tube_order: 2, sort_order: 2 }),
        ],
      ])
      const id = created.rows[0].id
      return {
        kit: (await tx.query("select layout_orientation from public.kits where id = $1", [id])).rows[0],
        targets: (
          await tx.query(
            `select tube_name, tube_order, std_slope::float as std_slope, std_intercept::float as std_intercept,
                    pc_copies::float as pc_copies
             from public.kit_targets where kit_id = $1 order by sort_order`,
            [id]
          )
        ).rows,
      }
    })
    expect(result.kit).toEqual({ layout_orientation: "tubes_in_columns" })
    expect(result.targets).toEqual([
      { tube_name: "PPM 1", tube_order: 1, std_slope: -3.3, std_intercept: 40, pc_copies: 2000000 },
      { tube_name: "PPM 2", tube_order: 2, std_slope: null, std_intercept: null, pc_copies: null },
    ])
  })

  it("refuses two targets read in the same dye in one tube", async () => {
    // The constraint is deferred to commit; runAs rolls back, so check it explicitly.
    await expect(
      runAs(db, "authenticated", SUPER, async (tx) => {
        await tx.query("select public.save_kit($1, $2)", [
          { name: "Clash", version: "1", active: true },
          [target({ tube_name: "T" }), target({ target_name: "Target 2", tube_name: "T", sort_order: 2 })],
        ])
        await tx.query("set constraints all immediate")
      })
    ).rejects.toThrow(/kit_targets_tube_fluorophore_key/)
  })

  it("refuses targets that belong to another kit", async () => {
    const otherTarget = (await db.query<{ id: string }>("select id from public.kit_targets limit 1")).rows[0].id
    await expect(
      asSuper("select public.save_kit($1, $2)", [
        { name: "Sneaky", version: "1", active: true },
        [target({ id: otherTarget })],
      ])
    ).rejects.toThrow(/does not belong to this kit/)
  })

  it("requires at least one target", async () => {
    await expect(
      asSuper("select public.save_kit($1, $2)", [{ name: "Empty", version: "1", active: true }, []])
    ).rejects.toThrow(/at least one target/)
  })

  it("only lets a super admin edit kits", async () => {
    await expect(
      runAs(db, "authenticated", PROJECT_ADMIN, (tx) =>
        tx.query("select public.save_kit($1, $2)", [{ name: "X", version: "1", active: true }, [target()]])
      )
    ).rejects.toThrow(/Only a super admin/)
  })
})
