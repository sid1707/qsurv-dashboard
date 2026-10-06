import type { PGlite, Transaction } from "@electric-sql/pglite"
import { beforeAll, describe, expect, it } from "vitest"
import { createMigratedDb, runAs } from "./harness"

// Project P: centres CA (active) and CB (inactive); centre users CA_USER, CB_USER; admin ADMIN.
const U = {
  ADMIN: "00000000-0000-4000-8000-0000000000c1",
  CA_USER: "00000000-0000-4000-8000-0000000000c2",
  CB_USER: "00000000-0000-4000-8000-0000000000c3",
}
const P = "10000000-0000-4000-8000-0000000000c1"
const CA = "20000000-0000-4000-8000-0000000000c1"
const CB = "20000000-0000-4000-8000-0000000000c2"
const BATCH = "30000000-0000-4000-8000-0000000000c1"

let db: PGlite

async function errorOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error as { message: string }
  }
  throw new Error("Expected the query to fail")
}

const insertDraft = (centre: string, user: string, extra = "") =>
  `insert into public.upload_batches (project_id, centre_id, uploaded_by${extra ? ", upload_status" : ""})
   values ('${P}', '${centre}', '${user}'${extra ? `, '${extra}'` : ""})`

beforeAll(async () => {
  db = await createMigratedDb()
  const kit = (await db.query<{ id: string }>("select id from public.kits limit 1")).rows[0].id
  for (const id of Object.values(U)) await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id.slice(-2)}@x.org`])
  await db.query(
    "insert into public.projects (id, code, title, sample_type, frequency, kit_id) values ($1, 'PROJ-UP', 'Uploads', 'wastewater', 'weekly', $2)",
    [P, kit]
  )
  await db.query("insert into public.centres (id, project_id, name, active) values ($1, $3, 'A', true), ($2, $3, 'B', false)", [CA, CB, P])
  await db.query(
    `insert into public.project_memberships (user_id, project_id, centre_id, role) values
       ($1, $4, null, 'project_admin'), ($2, $4, $5, 'centre_user'), ($3, $4, $6, 'centre_user')`,
    [U.ADMIN, U.CA_USER, U.CB_USER, P, CA, CB]
  )
  await db.query(
    "insert into public.upload_batches (id, project_id, centre_id, uploaded_by) values ($1, $2, $3, $4)",
    [BATCH, P, CA, U.CA_USER]
  )
}, 60_000)

describe("starting uploads", () => {
  it("lets a centre user start a draft for their active centre", async () => {
    await runAs(db, "authenticated", U.CA_USER, (tx) => tx.query(insertDraft(CA, U.CA_USER)))
  })

  it("refuses uploads for a deactivated centre", async () => {
    const err = await errorOf(runAs(db, "authenticated", U.CB_USER, (tx) => tx.query(insertDraft(CB, U.CB_USER))))
    expect(err.message).toMatch(/row-level security/)
  })

  it("refuses a centre user's batch that does not start as a draft", async () => {
    const err = await errorOf(runAs(db, "authenticated", U.CA_USER, (tx) => tx.query(insertDraft(CA, U.CA_USER, "uploaded"))))
    expect(err.message).toMatch(/start as drafts/)
  })
})

describe("pipeline status", () => {
  it("cannot be moved by the centre user", async () => {
    for (const set of ["upload_status = 'uploaded'", "processing_status = 'completed'", "submitted_at = now()", "warning_acknowledged = true"]) {
      const err = await errorOf(
        runAs(db, "authenticated", U.CA_USER, (tx) => tx.query(`update public.upload_batches set ${set} where id = $1`, [BATCH]))
      )
      expect(err.message, set).toMatch(/set by QSurv after validation/)
    }
  })

  it("leaves other fields, like notes, editable by the uploader", async () => {
    await runAs(db, "authenticated", U.CA_USER, async (tx) => {
      const { affectedRows } = await tx.query("update public.upload_batches set notes = 'x' where id = $1", [BATCH])
      expect(affectedRows).toBe(1)
    })
  })

  it("is set by the server (service role) and project admins", async () => {
    await runAs(db, "service_role", null, (tx) =>
      tx.query("update public.upload_batches set upload_status = 'uploaded', processing_status = 'completed' where id = $1", [BATCH])
    )
    await runAs(db, "authenticated", U.ADMIN, async (tx) => {
      const { affectedRows } = await tx.query("update public.upload_batches set upload_status = 'rejected' where id = $1", [BATCH])
      expect(affectedRows).toBe(1)
    })
  })
})

describe("upload files", () => {
  const OWN_PATH = `PROJ-UP/${CA}/${BATCH}/results/run.csv`
  const insertFile = (tx: Transaction, path: string) =>
    tx.query(
      `insert into public.upload_files (upload_batch_id, project_id, centre_id, file_kind, original_filename, storage_bucket, storage_path, sha256)
       values ($1, $2, $3, 'results', 'run.csv', 'qsurv-files', $4, 'abc')`,
      [BATCH, P, CA, path]
    )

  it("records the results export as its own file kind", async () => {
    await runAs(db, "authenticated", U.CA_USER, (tx) => insertFile(tx, OWN_PATH))
  })

  it("refuses a file outside the upload's own folder", async () => {
    for (const path of [`PROJ-UP/${CA}/other-upload/results/run.csv`, `PROJ-UP/${CA}/${BATCH}/runfile/run.csv`, `PROJ-UP/${CA}/${BATCH}/results/a/run.csv`]) {
      const err = await errorOf(runAs(db, "authenticated", U.CA_USER, (tx) => insertFile(tx, path)))
      expect(err.message, path).toMatch(/row-level security/)
    }
  })

  it("does not let the uploader swap the file once the upload is submitted", async () => {
    await runAs(db, "authenticated", U.CA_USER, async (tx) => {
      await insertFile(tx, OWN_PATH)
      await tx.query("set local role postgres")
      await tx.query("update public.upload_batches set upload_status = 'uploaded', processing_status = 'completed' where id = $1", [BATCH])
      await tx.query("set local role authenticated")
      const { affectedRows } = await tx.query(
        "update public.upload_files set storage_path = $2 where upload_batch_id = $1",
        [BATCH, `PROJ-UP/${CA}/${BATCH}/results/unchecked.csv`]
      )
      expect(affectedRows).toBe(0)
      const err = await errorOf(
        tx.query(
          `insert into public.upload_files (upload_batch_id, project_id, centre_id, file_kind, original_filename, storage_bucket, storage_path)
           values ($1, $2, $3, 'runfile', 'run.eds', 'qsurv-files', $4)`,
          [BATCH, P, CA, `PROJ-UP/${CA}/${BATCH}/runfile/run.eds`]
        )
      )
      expect(err.message).toMatch(/row-level security/)
    })
  })
})
