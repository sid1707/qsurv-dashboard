import type { PGlite, Transaction } from "@electric-sql/pglite"
import { beforeAll, describe, expect, it } from "vitest"
import { createMigratedDb, runAs } from "./harness"

// Fixture layout:
//   Project P1 (PROJ-ONE): centres C1A, C1B; admin ADMIN1; users C1A_USER, C1B_USER
//   Project P2 (PROJ-TWO): centre C2A; admin ADMIN2; user C2A_USER
//   SUPER is a super admin; OUTSIDER has an account but no memberships.
const U = {
  SUPER: "00000000-0000-4000-8000-000000000001",
  ADMIN1: "00000000-0000-4000-8000-000000000002",
  C1A_USER: "00000000-0000-4000-8000-000000000003",
  C1B_USER: "00000000-0000-4000-8000-000000000004",
  ADMIN2: "00000000-0000-4000-8000-000000000005",
  C2A_USER: "00000000-0000-4000-8000-000000000006",
  OUTSIDER: "00000000-0000-4000-8000-000000000007",
}
const P1 = "10000000-0000-4000-8000-000000000001"
const P2 = "10000000-0000-4000-8000-000000000002"
const C1A = "20000000-0000-4000-8000-000000000001"
const C1B = "20000000-0000-4000-8000-000000000002"
const C2A = "20000000-0000-4000-8000-000000000003"
const CODES: Record<string, string> = { [P1]: "PROJ-ONE", [P2]: "PROJ-TWO" }

const CENTRES = [
  { id: C1A, project: P1, user: U.C1A_USER, batch: "30000000-0000-4000-8000-000000000001" },
  { id: C1B, project: P1, user: U.C1B_USER, batch: "30000000-0000-4000-8000-000000000002" },
  { id: C2A, project: P2, user: U.C2A_USER, batch: "30000000-0000-4000-8000-000000000003" },
]
const BATCH = Object.fromEntries(CENTRES.map((c) => [c.id, c.batch]))

const ANN = {
  P1_ALL: "40000000-0000-4000-8000-000000000001",
  P1_C1B_ONLY: "40000000-0000-4000-8000-000000000002",
  P1_ARCHIVED: "40000000-0000-4000-8000-000000000003",
  P2_ALL: "40000000-0000-4000-8000-000000000004",
}

const CENTRE_SCOPED_TABLES = [
  "upload_batches",
  "upload_files",
  "validation_runs",
  "validation_issues",
  "compiled_measurements",
] as const

let db: PGlite

async function seed(db: PGlite) {
  for (const [name, id] of Object.entries(U)) {
    await db.query(
      "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)",
      [id, `${name.toLowerCase()}@example.org`, JSON.stringify({ full_name: name })]
    )
  }
  await db.query("update public.profiles set is_super_admin = true where user_id = $1", [U.SUPER])

  const kit = await db.query<{ id: string }>(
    "select id from public.kits where name = 'Huwel Multipathogen'"
  )
  const kitId = kit.rows[0].id
  for (const [id, code] of Object.entries(CODES)) {
    await db.query(
      `insert into public.projects (id, code, title, sample_type, frequency, kit_id)
       values ($1, $2, $3, 'wastewater', 'weekly', $4)`,
      [id, code, `Project ${code}`, kitId]
    )
  }

  for (const c of CENTRES) {
    await db.query(
      "insert into public.centres (id, project_id, name, city, state) values ($1, $2, $3, 'City', 'State')",
      [c.id, c.project, `Centre ${c.id.slice(-1)}`]
    )
  }

  await db.query(
    `insert into public.project_memberships (user_id, project_id, centre_id, role) values
       ($1, $3, null, 'project_admin'),
       ($2, $4, null, 'project_admin')`,
    [U.ADMIN1, U.ADMIN2, P1, P2]
  )
  for (const c of CENTRES) {
    await db.query(
      "insert into public.project_memberships (user_id, project_id, centre_id, role) values ($1, $2, $3, 'centre_user')",
      [c.user, c.project, c.id]
    )
  }

  for (const c of CENTRES) {
    const path = `${CODES[c.project]}/${c.id}/run-1.xlsx`
    await db.query(
      `insert into public.upload_batches (id, project_id, centre_id, kit_id, uploaded_by, upload_status)
       values ($1, $2, $3, $4, $5, 'uploaded')`,
      [c.batch, c.project, c.id, kitId, c.user]
    )
    await db.query(
      `insert into public.upload_files
         (upload_batch_id, project_id, centre_id, file_kind, original_filename, storage_bucket, storage_path)
       values ($1, $2, $3, 'runfile', 'run-1.xlsx', 'qsurv-files', $4)`,
      [c.batch, c.project, c.id, path]
    )
    const run = await db.query<{ id: string }>(
      `insert into public.validation_runs (upload_batch_id, project_id, centre_id, engine_version, passed, warning_count)
       values ($1, $2, $3, 'test', true, 1) returning id`,
      [c.batch, c.project, c.id]
    )
    await db.query(
      `insert into public.validation_issues (validation_run_id, project_id, centre_id, severity, issue_code, message)
       values ($1, $2, $3, 'warning', 'CT_HIGH', 'Ct above range')`,
      [run.rows[0].id, c.project, c.id]
    )
    await db.query(
      `insert into public.compiled_measurements
         (upload_batch_id, validation_run_id, project_id, centre_id, target_name, cq_value, collection_date)
       values ($1, $2, $3, $4, 'Target A', 30.5, '2026-09-01')`,
      [c.batch, run.rows[0].id, c.project, c.id]
    )
    await db.query("insert into storage.objects (bucket_id, name) values ('qsurv-files', $1)", [path])
  }

  await db.query(
    `insert into public.announcements (id, project_id, title, body, audience, created_by, archived_at) values
       ($1, $5, 'All P1', 'Body', 'all_centres', $7, null),
       ($2, $5, 'C1B only', 'Body', 'selected_centres', $7, null),
       ($3, $5, 'Archived', 'Body', 'all_centres', $7, now()),
       ($4, $6, 'All P2', 'Body', 'all_centres', $8, null)`,
    [ANN.P1_ALL, ANN.P1_C1B_ONLY, ANN.P1_ARCHIVED, ANN.P2_ALL, P1, P2, U.ADMIN1, U.ADMIN2]
  )
  await db.query(
    "insert into public.announcement_centres (announcement_id, project_id, centre_id) values ($1, $2, $3)",
    [ANN.P1_C1B_ONLY, P1, C1B]
  )

  await db.query(
    `insert into public.audit_events (project_id, actor_user_id, event_type, entity_type, entity_id) values
       ($1, $3, 'batch.approved', 'upload_batch', 'x'),
       ($2, $4, 'batch.approved', 'upload_batch', 'y')`,
    [P1, P2, U.ADMIN1, U.ADMIN2]
  )

  await db.query(
    `insert into public.project_requests
       (requester_user_id, requester_name, requester_email, institution_name,
        project_title, objective, sample_type, frequency)
     values ($1, 'Outsider', 'outsider@example.org', 'Some Lab', 'New project', 'Objective', 'wastewater', 'weekly')`,
    [U.OUTSIDER]
  )
}

async function select(tx: Transaction, sql: string, params: unknown[] = []) {
  return (await tx.query<Record<string, unknown>>(sql, params)).rows
}

function centreIds(rows: Record<string, unknown>[]) {
  return [...new Set(rows.map((r) => r.centre_id))].sort()
}

beforeAll(async () => {
  db = await createMigratedDb()
  await seed(db)
}, 60_000)

describe("centre user isolation", () => {
  const me = U.C1A_USER

  it.each(CENTRE_SCOPED_TABLES)("only sees their own centre's rows in %s", async (table) => {
    const rows = await runAs(db, "authenticated", me, (tx) =>
      select(tx, `select project_id, centre_id from public.${table}`)
    )
    expect(rows.length).toBeGreaterThan(0)
    expect(centreIds(rows)).toEqual([C1A])
  })

  it("cannot read another centre's or another project's batch by id", async () => {
    const rows = await runAs(db, "authenticated", me, (tx) =>
      select(tx, "select id from public.upload_batches where id = any($1)", [[BATCH[C1B], BATCH[C2A]]])
    )
    expect(rows).toEqual([])
  })

  it("only sees their own centre and project", async () => {
    const [centres, projects] = await runAs(db, "authenticated", me, async (tx) => [
      await select(tx, "select id from public.centres"),
      await select(tx, "select id from public.projects"),
    ])
    expect(centres.map((r) => r.id)).toEqual([C1A])
    expect(projects.map((r) => r.id)).toEqual([P1])
  })

  it("only sees their own membership and profile", async () => {
    const [memberships, profiles] = await runAs(db, "authenticated", me, async (tx) => [
      await select(tx, "select user_id from public.project_memberships"),
      await select(tx, "select user_id from public.profiles"),
    ])
    expect(memberships.map((r) => r.user_id)).toEqual([me])
    expect(profiles.map((r) => r.user_id)).toEqual([me])
  })

  it("only sees storage objects under their own project and centre prefix", async () => {
    const rows = await runAs(db, "authenticated", me, (tx) =>
      select(tx, "select name from storage.objects")
    )
    expect(rows.map((r) => r.name)).toEqual([`PROJ-ONE/${C1A}/run-1.xlsx`])
  })

  it("only sees unarchived announcements addressed to their centre", async () => {
    const rows = await runAs(db, "authenticated", me, (tx) =>
      select(tx, "select id from public.announcements")
    )
    expect(rows.map((r) => r.id)).toEqual([ANN.P1_ALL])
  })

  it("cannot see which other centres an announcement targets", async () => {
    const rows = await runAs(db, "authenticated", me, (tx) =>
      select(tx, "select centre_id from public.announcement_centres")
    )
    expect(rows).toEqual([])
  })

  it("cannot read audit events or project requests", async () => {
    const [audit, requests] = await runAs(db, "authenticated", me, async (tx) => [
      await select(tx, "select id from public.audit_events"),
      await select(tx, "select id from public.project_requests"),
    ])
    expect(audit).toEqual([])
    expect(requests).toEqual([])
  })

  it("can create a batch for their own centre", async () => {
    const rows = await runAs(db, "authenticated", me, (tx) =>
      select(
        tx,
        "insert into public.upload_batches (project_id, centre_id, uploaded_by) values ($1, $2, $3) returning id",
        [P1, C1A, me]
      )
    )
    expect(rows).toHaveLength(1)
  })

  it.each([
    ["another centre in the same project", P1, C1B],
    ["a centre in another project", P2, C2A],
    ["their centre under another project id", P2, C1A],
  ])("cannot create a batch for %s", async (_label, projectId, centreId) => {
    await expect(
      runAs(db, "authenticated", me, (tx) =>
        tx.query(
          "insert into public.upload_batches (project_id, centre_id, uploaded_by) values ($1, $2, $3)",
          [projectId, centreId, me]
        )
      )
    ).rejects.toThrow()
  })

  it("cannot approve their own batch", async () => {
    await expect(
      runAs(db, "authenticated", me, (tx) =>
        tx.query(
          "update public.upload_batches set approval_status = 'approved', approved_by = $2, approved_at = now() where id = $1",
          [BATCH[C1A], me]
        )
      )
    ).rejects.toThrow(/row-level security/)
  })

  it("cannot update or delete another centre's batch", async () => {
    const [updated, deleted] = await runAs(db, "authenticated", me, async (tx) => [
      await tx.query("update public.upload_batches set notes = 'x' where id = any($1)", [[BATCH[C1B], BATCH[C2A]]]),
      await tx.query("delete from public.upload_batches where id = any($1)", [[BATCH[C1B], BATCH[C2A]]]),
    ])
    expect(updated.affectedRows).toBe(0)
    expect(deleted.affectedRows).toBe(0)
  })

  it("cannot write validation results, even for their own centre", async () => {
    await expect(
      runAs(db, "authenticated", me, (tx) =>
        tx.query(
          `insert into public.validation_runs (upload_batch_id, project_id, centre_id, engine_version, passed)
           values ($1, $2, $3, 'forged', true)`,
          [BATCH[C1A], P1, C1A]
        )
      )
    ).rejects.toThrow(/row-level security/)
  })

  it("can upload to their own storage prefix but not another centre's or project's", async () => {
    await runAs(db, "authenticated", me, (tx) =>
      tx.query("insert into storage.objects (bucket_id, name) values ('qsurv-files', $1)", [
        `PROJ-ONE/${C1A}/run-2.xlsx`,
      ])
    )
    for (const name of [`PROJ-ONE/${C1B}/run-2.xlsx`, `PROJ-TWO/${C2A}/run-2.xlsx`, `PROJ-TWO/${C1A}/run-2.xlsx`]) {
      await expect(
        runAs(db, "authenticated", me, (tx) =>
          tx.query("insert into storage.objects (bucket_id, name) values ('qsurv-files', $1)", [name])
        )
      ).rejects.toThrow(/row-level security/)
    }
  })

  it("cannot make themselves a super admin", async () => {
    await expect(
      runAs(db, "authenticated", me, (tx) =>
        tx.query("update public.profiles set is_super_admin = true where user_id = $1", [me])
      )
    ).rejects.toThrow(/permission denied/)
  })

  it("can update their own name", async () => {
    const result = await runAs(db, "authenticated", me, (tx) =>
      tx.query("update public.profiles set full_name = 'New Name' where user_id = $1", [me])
    )
    expect(result.affectedRows).toBe(1)
  })

  it("cannot join another project or centre", async () => {
    await expect(
      runAs(db, "authenticated", me, (tx) =>
        tx.query(
          "insert into public.project_memberships (user_id, project_id, centre_id, role) values ($1, $2, $3, 'centre_user')",
          [me, P2, C2A]
        )
      )
    ).rejects.toThrow(/row-level security/)
  })
})

describe("project admin", () => {
  it("sees every centre in their project and nothing from other projects", async () => {
    for (const table of CENTRE_SCOPED_TABLES) {
      const rows = await runAs(db, "authenticated", U.ADMIN1, (tx) =>
        select(tx, `select centre_id from public.${table}`)
      )
      expect(centreIds(rows)).toEqual([C1A, C1B].sort())
    }
    const objects = await runAs(db, "authenticated", U.ADMIN1, (tx) =>
      select(tx, "select name from storage.objects order by name")
    )
    expect(objects.every((r) => String(r.name).startsWith("PROJ-ONE/"))).toBe(true)
  })

  it("can approve a batch in their project", async () => {
    const result = await runAs(db, "authenticated", U.ADMIN1, (tx) =>
      tx.query(
        "update public.upload_batches set approval_status = 'approved', approved_by = $2, approved_at = now() where id = $1",
        [BATCH[C1A], U.ADMIN1]
      )
    )
    expect(result.affectedRows).toBe(1)
  })

  it("cannot touch another project's batches", async () => {
    const result = await runAs(db, "authenticated", U.ADMIN1, (tx) =>
      tx.query("update public.upload_batches set notes = 'x' where id = $1", [BATCH[C2A]])
    )
    expect(result.affectedRows).toBe(0)
  })

  it("sees all of their project's announcements and audit events only", async () => {
    const [announcements, audit] = await runAs(db, "authenticated", U.ADMIN1, async (tx) => [
      await select(tx, "select id from public.announcements order by id"),
      await select(tx, "select project_id from public.audit_events"),
    ])
    expect(announcements.map((r) => r.id)).toEqual([ANN.P1_ALL, ANN.P1_C1B_ONLY, ANN.P1_ARCHIVED])
    expect(audit.map((r) => r.project_id)).toEqual([P1])
  })

  it("sees profiles of their project's members only", async () => {
    const rows = await runAs(db, "authenticated", U.ADMIN1, (tx) =>
      select(tx, "select user_id from public.profiles order by user_id")
    )
    expect(rows.map((r) => r.user_id)).toEqual([U.ADMIN1, U.C1A_USER, U.C1B_USER])
  })
})

describe("super admin", () => {
  it("sees rows from every project and centre", async () => {
    for (const table of CENTRE_SCOPED_TABLES) {
      const rows = await runAs(db, "authenticated", U.SUPER, (tx) =>
        select(tx, `select centre_id from public.${table}`)
      )
      expect(centreIds(rows)).toEqual([C1A, C1B, C2A].sort())
    }
  })

  it("sees every project request", async () => {
    const rows = await runAs(db, "authenticated", U.SUPER, (tx) =>
      select(tx, "select id from public.project_requests")
    )
    expect(rows).toHaveLength(1)
  })
})

describe("users outside a project", () => {
  it("an authenticated user with no memberships sees no project data", async () => {
    const counts = await runAs(db, "authenticated", U.OUTSIDER, async (tx) => {
      const out: Record<string, number> = {}
      for (const table of [...CENTRE_SCOPED_TABLES, "projects", "centres", "announcements"]) {
        out[table] = (await select(tx, `select 1 from public.${table}`)).length
      }
      out["storage.objects"] = (await select(tx, "select 1 from storage.objects")).length
      return out
    })
    expect(Object.values(counts).every((n) => n === 0)).toBe(true)
  })

  it("a requester sees only their own project request", async () => {
    const rows = await runAs(db, "authenticated", U.OUTSIDER, (tx) =>
      select(tx, "select requester_user_id from public.project_requests")
    )
    expect(rows.map((r) => r.requester_user_id)).toEqual([U.OUTSIDER])
  })

  it("anonymous visitors can list active kits and targets for the onboarding form", async () => {
    const [kits, targets] = await runAs(db, "anon", null, async (tx) => [
      await select(tx, "select name from public.kits order by name"),
      await select(tx, "select id from public.kit_targets"),
    ])
    // The placeholder kits are inactive, so their targets are hidden too.
    expect(kits.map((r) => r.name)).toEqual([
      "Quantiplus ENV-AMR (8 tube)",
      "Quantiplus ENV-AMR V2 (15 tube)",
      "Quantiplus Waste Water Surveillance (10 tube)",
    ])
    expect(targets).toHaveLength(23 + 35 + 22)
  })

  it("anonymous visitors cannot read projects", async () => {
    await expect(
      runAs(db, "anon", null, (tx) => tx.query("select id from public.projects"))
    ).rejects.toThrow(/permission denied/)
  })
})
