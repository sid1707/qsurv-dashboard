import type { PGlite } from "@electric-sql/pglite"
import { beforeAll, describe, expect, it } from "vitest"
import { centreFileCode } from "../../lib/centres/file-name"
import { createMigratedDb, runAs } from "./harness"

const ADMIN = "00000000-0000-4000-8000-0000000000d1"
const USER = "00000000-0000-4000-8000-0000000000d2"
const OTHER_USER = "00000000-0000-4000-8000-0000000000d3"
const P = "10000000-0000-4000-8000-0000000000d1"
const CA = "20000000-0000-4000-8000-0000000000d1"
const CB = "20000000-0000-4000-8000-0000000000d2"

let db: PGlite

async function errorOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error as { message: string }
  }
  throw new Error("Expected the query to fail")
}

const centre = async (id: string) =>
  (await db.query<{ code: string | null; file_code: string }>("select code, file_code from public.centres where id = $1", [id])).rows[0]

beforeAll(async () => {
  db = await createMigratedDb()
  const kit = (await db.query<{ id: string }>("select id from public.kits limit 1")).rows[0].id
  for (const id of [ADMIN, USER, OTHER_USER]) await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${id.slice(-2)}@x.org`])
  await db.query("insert into public.projects (id, code, title, sample_type, frequency, kit_id) values ($1, 'PROJ-FN', 'Files', 'wastewater', 'weekly', $2)", [P, kit])
  await db.query(
    "insert into public.centres (id, project_id, name, city) values ($1, $3, 'AIIMS (Delhi)', 'New Delhi'), ($2, $3, 'KEM Hospital', 'Pune')",
    [CA, CB, P]
  )
  await db.query(
    `insert into public.project_memberships (user_id, project_id, centre_id, role) values
       ($1, $4, null, 'project_admin'), ($2, $4, $5, 'centre_user'), ($3, $4, $6, 'centre_user')`,
    [ADMIN, USER, OTHER_USER, P, CA, CB]
  )
}, 60_000)

describe("centre file code", () => {
  it("is the name and location without spaces or punctuation, matching the app", async () => {
    expect((await centre(CA)).file_code).toBe("AIIMSDelhi_NewDelhi")
    expect(centreFileCode("AIIMS (Delhi)", "New Delhi")).toBe("AIIMSDelhi_NewDelhi")
  })

  it("follows name changes until the centre uploads, then stays fixed", async () => {
    await runAs(db, "authenticated", ADMIN, async (tx) => {
      await tx.query("update public.centres set city = 'Delhi' where id = $1", [CA])
      const before = await tx.query<{ file_code: string }>("select file_code from public.centres where id = $1", [CA])
      expect(before.rows[0].file_code).toBe("AIIMSDelhi_Delhi")

      await tx.query("set local role postgres")
      await tx.query("insert into public.upload_batches (project_id, centre_id, uploaded_by, upload_status) values ($1, $2, $3, 'uploaded')", [P, CA, USER])
      await tx.query("set local role authenticated")

      await tx.query("update public.centres set name = 'AIIMS New', city = 'Noida' where id = $1", [CA])
      const after = await tx.query<{ file_code: string; name: string }>("select file_code, name from public.centres where id = $1", [CA])
      expect(after.rows[0]).toEqual({ file_code: "AIIMSDelhi_Delhi", name: "AIIMS New" })
    })
  })
})

describe("centre ID", () => {
  it("is stored upper case and unique within the project", async () => {
    await runAs(db, "authenticated", ADMIN, async (tx) => {
      await tx.query("update public.centres set code = ' c01 ' where id = $1", [CA])
      const { rows } = await tx.query<{ code: string }>("select code from public.centres where id = $1", [CA])
      expect(rows[0].code).toBe("C01")
      const err = await tx.query("update public.centres set code = 'C01' where id = $1", [CB]).catch((e: Error) => e)
      expect((err as Error).message).toMatch(/duplicate key/)
    })
  })

  it("rejects spaces and underscores, which would break the file name", async () => {
    for (const bad of ["C 01", "C_01"]) {
      const err = await errorOf(runAs(db, "authenticated", ADMIN, (tx) => tx.query("update public.centres set code = $2 where id = $1", [CB, bad])))
      expect(err.message).toMatch(/centres_code_format/)
    }
  })

  it("cannot change once the centre has uploaded files", async () => {
    const err = await errorOf(
      runAs(db, "authenticated", ADMIN, async (tx) => {
        await tx.query("update public.centres set code = 'C01' where id = $1", [CA])
        await tx.query("set local role postgres")
        await tx.query("insert into public.upload_batches (project_id, centre_id, uploaded_by, upload_status) values ($1, $2, $3, 'uploaded')", [P, CA, USER])
        await tx.query("set local role authenticated")
        await tx.query("update public.centres set code = 'C09' where id = $1", [CA])
      })
    )
    expect(err.message).toMatch(/cannot change once the centre has uploaded/)
  })
})

describe("split files", () => {
  it("are written by the server and read only by the centre and its admins", async () => {
    const batch = "30000000-0000-4000-8000-0000000000d1"
    await runAs(db, "authenticated", USER, async (tx) => {
      await tx.query("set local role postgres")
      await tx.query("insert into public.upload_batches (id, project_id, centre_id, uploaded_by) values ($1, $2, $3, $4)", [batch, P, CA, USER])
      await tx.query("set local role service_role")
      await tx.query(
        `insert into public.upload_split_artifacts (upload_batch_id, project_id, centre_id, split_index, split_mode, split_key, display_filename, storage_bucket, storage_path)
         values ($1, $2, $3, 0, 'by_date', '011026', 'C01_AIIMS_Delhi_011026.csv', 'qsurv-files', 'x')`,
        [batch, P, CA]
      )
      await tx.query("set local role authenticated")
      expect((await tx.query("select 1 from public.upload_split_artifacts")).rows).toHaveLength(1)
      const err = await tx
        .query(
          `insert into public.upload_split_artifacts (upload_batch_id, project_id, centre_id, split_index, split_mode, split_key, display_filename, storage_bucket, storage_path)
           values ($1, $2, $3, 1, 'by_date', 'x', 'x.csv', 'qsurv-files', 'y')`,
          [batch, P, CA]
        )
        .catch((e: Error) => e)
      expect((err as Error).message).toMatch(/row-level security/)
    })
    const hidden = await runAs(db, "authenticated", OTHER_USER, async (tx) => {
      await tx.query("set local role postgres")
      await tx.query("insert into public.upload_batches (id, project_id, centre_id, uploaded_by) values ($1, $2, $3, $4)", [batch, P, CA, USER])
      await tx.query(
        `insert into public.upload_split_artifacts (upload_batch_id, project_id, centre_id, split_index, split_mode, split_key, display_filename, storage_bucket, storage_path)
         values ($1, $2, $3, 0, 'by_date', 'k', 'f.csv', 'qsurv-files', 'x')`,
        [batch, P, CA]
      )
      await tx.query("set local role authenticated")
      return (await tx.query("select 1 from public.upload_split_artifacts")).rows.length
    })
    expect(hidden).toBe(0)
  })

  it("cannot be marked on a batch by the centre user", async () => {
    const err = await errorOf(
      runAs(db, "authenticated", USER, (tx) =>
        tx.query("insert into public.upload_batches (project_id, centre_id, uploaded_by, split_mode) values ($1, $2, $3, 'by_date')", [P, CA, USER])
      )
    )
    expect(err.message).toMatch(/start as drafts/)
  })
})
