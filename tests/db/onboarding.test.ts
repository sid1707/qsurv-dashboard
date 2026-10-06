import type { PGlite } from "@electric-sql/pglite"
import { beforeAll, describe, expect, it } from "vitest"
import { createMigratedDb, runAs } from "./harness"

let db: PGlite

beforeAll(async () => {
  db = await createMigratedDb()
}, 60_000)

async function insertRequest(code: string, status = "pending") {
  const reviewed = status === "pending" ? null : new Date().toISOString()
  return db.query<{ reference: string }>(
    `insert into public.project_requests
       (requester_name, requester_email, institution_name, project_title, objective,
        sample_type, frequency, requested_code, status, reviewed_at)
     values ('A', 'a@example.org', 'Lab', 'Title', 'Objective', 'wastewater', 'weekly', $1, $2, $3)
     returning reference`,
    [code, status, reviewed]
  )
}

describe("project request references and short codes", () => {
  it("generates a QS- reference for every request", async () => {
    const { rows } = await insertRequest("REF-TEST")
    expect(rows[0].reference).toMatch(/^QS-[0-9A-F]{8}$/)
  })

  it("does not let two active requests reserve the same short code", async () => {
    await insertRequest("DUP-CODE")
    await expect(insertRequest("DUP-CODE")).rejects.toThrow(/duplicate key/)
  })

  it("frees a short code once its request is rejected", async () => {
    await insertRequest("REUSE-ME", "rejected")
    await expect(insertRequest("REUSE-ME")).resolves.toBeDefined()
  })

  it.each([
    ["requested_code", "lower-case"],
    ["sample_type", "soil"],
    ["frequency", "daily"],
    ["instrument", "abacus"],
    ["user_tier", "lots"],
  ])("rejects an invalid %s", async (column, value) => {
    const row: Record<string, string> = {
      requester_name: "A",
      requester_email: "a@example.org",
      institution_name: "Lab",
      project_title: "Title",
      objective: "Objective",
      sample_type: "wastewater",
      frequency: "weekly",
      [column]: value,
    }
    const columns = Object.keys(row)
    await expect(
      db.query(
        `insert into public.project_requests (${columns.join(", ")})
         values (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
        Object.values(row)
      )
    ).rejects.toThrow(/violates check constraint/)
  })
})

describe("consume_rate_limit", () => {
  async function hit(key: string, limit = 2) {
    const { rows } = await db.query<{ ok: boolean }>(
      "select public.consume_rate_limit('test', $1, $2, 3600) as ok",
      [key, limit]
    )
    return rows[0].ok
  }

  it("allows hits up to the limit, then blocks", async () => {
    expect(await hit("ip-a")).toBe(true)
    expect(await hit("ip-a")).toBe(true)
    expect(await hit("ip-a")).toBe(false)
  })

  it("counts each key separately", async () => {
    expect(await hit("ip-b")).toBe(true)
  })

  it("forgets hits older than the window", async () => {
    await db.query(
      "insert into public.rate_limit_hits (bucket, key_hash, created_at) values ('test', 'ip-old', now() - interval '2 hours'), ('test', 'ip-old', now() - interval '2 hours')"
    )
    expect(await hit("ip-old")).toBe(true)
  })

  it("can only be called by the service role", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      await expect(
        runAs(db, role, null, (tx) => tx.query("select public.consume_rate_limit('test', 'x', 5, 60)"))
      ).rejects.toThrow(/permission denied/)
    }
    const ok = await runAs(db, "service_role", null, (tx) =>
      tx.query<{ ok: boolean }>("select public.consume_rate_limit('test', 'svc', 5, 60) as ok")
    )
    expect(ok.rows[0].ok).toBe(true)
  })

  it("keeps the hit table private from API users", async () => {
    await expect(
      runAs(db, "anon", null, (tx) => tx.query("select * from public.rate_limit_hits"))
    ).rejects.toThrow(/permission denied/)
  })
})
