import type { PGlite, Transaction } from "@electric-sql/pglite"
import { beforeAll, describe, expect, it } from "vitest"
import { createMigratedDb, runAs } from "./harness"

// Project P (compilation on) with centres CA, CB; project Q (compilation off).
const U = {
  ADMIN: "00000000-0000-4000-8000-0000000000d1",
  CA_USER: "00000000-0000-4000-8000-0000000000d2",
  CB_USER: "00000000-0000-4000-8000-0000000000d3",
  OTHER_ADMIN: "00000000-0000-4000-8000-0000000000d4",
}
const P = "10000000-0000-4000-8000-0000000000d1"
const Q = "10000000-0000-4000-8000-0000000000d2"
const CA = "20000000-0000-4000-8000-0000000000d1"
const CB = "20000000-0000-4000-8000-0000000000d2"
const CQ = "20000000-0000-4000-8000-0000000000d3"
const B = {
  READY: "30000000-0000-4000-8000-0000000000d1",
  DRAFT: "30000000-0000-4000-8000-0000000000d2",
  FAILED_RUN: "30000000-0000-4000-8000-0000000000d3",
  Q_READY: "30000000-0000-4000-8000-0000000000d4",
}

let db: PGlite
let targetId: string
let targetName: string
let otherKitTargetId: string

async function errorOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error as { message: string }
  }
  throw new Error("Expected the query to fail")
}

const measurement = (overrides: Record<string, unknown> = {}) => ({
  kit_target_id: targetId,
  collection_date: "2026-10-01",
  sample_label: "WW-01",
  target_name: targetName,
  cq_value: 24.55,
  cq_sd: 0.14,
  normalized_cq: 1.659,
  copy_number: null,
  copy_number_sd: null,
  metric_payload: { source_file: "run.csv" },
  ...overrides,
})

const approve = (tx: Transaction, batch: string, rows: unknown[] = [], notes: string | null = null) =>
  tx.query<{ r: { already_approved: boolean; upload_status: string; rows_written: number } }>(
    "select public.approve_upload($1, $2::jsonb, $3) as r",
    [batch, JSON.stringify(rows), notes]
  )

async function batch(id: string, project: string, centre: string, user: string, status: string, passed: boolean | null) {
  await db.query(
    `insert into public.upload_batches (id, project_id, centre_id, uploaded_by, upload_status, processing_status, submitted_at)
     values ($1, $2, $3, $4, $5::public.upload_status, $6::public.processing_status, now())`,
    [id, project, centre, user, status, status === "draft" ? null : "completed"]
  )
  if (passed !== null) {
    await db.query("insert into public.validation_runs (upload_batch_id, project_id, centre_id, engine_version, passed) values ($1, $2, $3, 'test', $4)", [
      id,
      project,
      centre,
      passed,
    ])
  }
}

beforeAll(async () => {
  db = await createMigratedDb()
  const kits = (await db.query<{ id: string }>("select id from public.kits order by name limit 2")).rows
  const t = (await db.query<{ id: string; target_name: string }>("select id, target_name from public.kit_targets where kit_id = $1 limit 1", [kits[0].id])).rows[0]
  targetId = t.id
  targetName = t.target_name
  otherKitTargetId = (await db.query<{ id: string }>("select id from public.kit_targets where kit_id = $1 limit 1", [kits[1].id])).rows[0].id

  for (const id of Object.values(U)) await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id.slice(-2)}@x.org`])
  await db.query(
    `insert into public.projects (id, code, title, sample_type, frequency, kit_id, data_compilation) values
       ($1, 'PROJ-AP', 'Approvals', 'wastewater', 'weekly', $3, true),
       ($2, 'PROJ-AQ', 'No compile', 'wastewater', 'weekly', $3, false)`,
    [P, Q, kits[0].id]
  )
  await db.query("insert into public.centres (id, project_id, name) values ($1, $4, 'A'), ($2, $4, 'B'), ($3, $5, 'Q1')", [CA, CB, CQ, P, Q])
  await db.query(
    `insert into public.project_memberships (user_id, project_id, centre_id, role) values
       ($1, $5, null, 'project_admin'), ($2, $5, $6, 'centre_user'), ($3, $5, $7, 'centre_user'), ($4, $8, null, 'project_admin')`,
    [U.ADMIN, U.CA_USER, U.CB_USER, U.OTHER_ADMIN, P, CA, CB, Q]
  )
  await batch(B.READY, P, CA, U.CA_USER, "uploaded", true)
  await batch(B.DRAFT, P, CA, U.CA_USER, "draft", null)
  await batch(B.FAILED_RUN, P, CA, U.CA_USER, "uploaded", false)
  await batch(B.Q_READY, Q, CQ, U.CA_USER, "uploaded", true)
}, 60_000)

describe("approve_upload", () => {
  it("stores the compiled rows in the batch's scope, approves and audits in one go", async () => {
    await runAs(db, "authenticated", U.ADMIN, async (tx) => {
      const { rows } = await approve(tx, B.READY, [measurement(), measurement({ sample_label: " " })], "note")
      expect(rows[0].r).toEqual({ already_approved: false, upload_status: "compiled", rows_written: 2 })

      const stored = await tx.query<{ project_id: string; centre_id: string; validation_run_id: string | null; sample_label: string | null }>(
        "select project_id, centre_id, validation_run_id, sample_label from public.compiled_measurements where upload_batch_id = $1 order by id",
        [B.READY]
      )
      expect(stored.rows.map((r) => [r.project_id, r.centre_id, r.validation_run_id !== null, r.sample_label])).toEqual([
        [P, CA, true, "WW-01"],
        [P, CA, true, null],
      ])
      const b = await tx.query<{ upload_status: string; approval_status: string; approved_by: string; compile_notes: string }>(
        "select upload_status, approval_status, approved_by, compile_notes from public.upload_batches where id = $1",
        [B.READY]
      )
      expect(b.rows[0]).toEqual({ upload_status: "compiled", approval_status: "approved", approved_by: U.ADMIN, compile_notes: "note" })
      const audit = await tx.query("select 1 from public.audit_events where event_type = 'upload.approved' and entity_id = $1", [B.READY])
      expect(audit.rows).toHaveLength(1)

      // A second approval changes nothing.
      expect((await approve(tx, B.READY, [measurement()])).rows[0].r).toMatchObject({ already_approved: true, rows_written: 2 })
    })
  })

  it("approves without rows as 'approved' (nothing compiled)", async () => {
    await runAs(db, "authenticated", U.ADMIN, async (tx) => {
      expect((await approve(tx, B.READY)).rows[0].r).toEqual({ already_approved: false, upload_status: "approved", rows_written: 0 })
    })
  })

  it("refuses centre users and other projects' admins", async () => {
    for (const user of [U.CA_USER, U.OTHER_ADMIN]) {
      const err = await errorOf(runAs(db, "authenticated", user, (tx) => approve(tx, B.READY)))
      expect(err.message, user).toMatch(/Upload not found/)
    }
  })

  it("refuses drafts and runs that failed validation", async () => {
    let err = await errorOf(runAs(db, "authenticated", U.ADMIN, (tx) => approve(tx, B.DRAFT)))
    expect(err.message).toMatch(/not ready for approval/)
    err = await errorOf(runAs(db, "authenticated", U.ADMIN, (tx) => approve(tx, B.FAILED_RUN)))
    expect(err.message).toMatch(/Validation did not pass/)
  })

  it("only takes targets of the project's kit", async () => {
    const err = await errorOf(
      runAs(db, "authenticated", U.ADMIN, (tx) => approve(tx, B.READY, [measurement({ kit_target_id: otherKitTargetId })]))
    )
    expect(err.message).toMatch(/targets of the project's kit/)
    const renamed = await errorOf(runAs(db, "authenticated", U.ADMIN, (tx) => approve(tx, B.READY, [measurement({ target_name: "Other" })])))
    expect(renamed.message).toMatch(/targets of the project's kit/)
  })

  it("refuses compiled rows when the project has compilation off, but still approves", async () => {
    const err = await errorOf(runAs(db, "authenticated", U.OTHER_ADMIN, (tx) => approve(tx, B.Q_READY, [measurement()])))
    expect(err.message).toMatch(/compilation is not switched on/)
    await runAs(db, "authenticated", U.OTHER_ADMIN, async (tx) => {
      expect((await approve(tx, B.Q_READY)).rows[0].r).toMatchObject({ upload_status: "approved" })
    })
  })
})

describe("reject_upload", () => {
  const reject = (tx: Transaction, id: string, reason: string) => tx.query("select public.reject_upload($1, $2)", [id, reason])

  it("rejects with the reason and audits it", async () => {
    await runAs(db, "authenticated", U.ADMIN, async (tx) => {
      await reject(tx, B.READY, "  Wrong plate layout  ")
      const b = await tx.query<{ upload_status: string; approval_status: string; rejection_reason: string }>(
        "select upload_status, approval_status, rejection_reason from public.upload_batches where id = $1",
        [B.READY]
      )
      expect(b.rows[0]).toEqual({ upload_status: "rejected", approval_status: "rejected", rejection_reason: "Wrong plate layout" })
      const err = await errorOf(approve(tx, B.READY))
      expect(err.message).toMatch(/was rejected/)
    })
  })

  it("needs a reason, a submitted upload and a project admin", async () => {
    expect((await errorOf(runAs(db, "authenticated", U.ADMIN, (tx) => reject(tx, B.READY, " ")))).message).toMatch(/reason/)
    expect((await errorOf(runAs(db, "authenticated", U.ADMIN, (tx) => reject(tx, B.DRAFT, "x")))).message).toMatch(/Only submitted uploads/)
    expect((await errorOf(runAs(db, "authenticated", U.CA_USER, (tx) => reject(tx, B.READY, "x")))).message).toMatch(/Upload not found/)
  })

  it("is not callable anonymously", async () => {
    const err = await errorOf(runAs(db, "anon", null, (tx) => reject(tx, B.READY, "x")))
    expect(err.message).toMatch(/permission denied/)
  })
})
