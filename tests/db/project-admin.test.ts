import type { PGlite } from "@electric-sql/pglite"
import { beforeAll, describe, expect, it } from "vitest"
import { createMigratedDb, runAs } from "./harness"

// Project P (PROJ-ADM, tier under_20): centres CA (active) and CB (inactive);
// admins ADMIN and ADMIN_B; centre user CA_USER. Project Q has admin Q_ADMIN.
const U = {
  ADMIN: "00000000-0000-4000-8000-0000000000b1",
  ADMIN_B: "00000000-0000-4000-8000-0000000000b2",
  CA_USER: "00000000-0000-4000-8000-0000000000b3",
  Q_ADMIN: "00000000-0000-4000-8000-0000000000b4",
}
const P = "10000000-0000-4000-8000-0000000000b1"
const Q = "10000000-0000-4000-8000-0000000000b2"
const CA = "20000000-0000-4000-8000-0000000000b1"
const CB = "20000000-0000-4000-8000-0000000000b2"

let db: PGlite
let kitId: string
let otherKitId: string

/** Fresh user ids for the user-limit test, distinct from the fixture users. */
const extraUser = (i: number) => `00000000-0000-4000-8000-${String(900000000000 + i)}`

async function as<T>(user: string, sql: string, params: unknown[] = []) {
  return runAs(db, "authenticated", user, (tx) => tx.query<T>(sql, params))
}

async function errorOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error as { message: string; code?: string }
  }
  throw new Error("Expected the query to fail")
}

beforeAll(async () => {
  db = await createMigratedDb()
  const kits = await db.query<{ id: string }>("select id from public.kits where active order by name limit 2")
  kitId = kits.rows[0].id
  otherKitId = kits.rows[1].id

  for (const [name, id] of Object.entries(U)) {
    await db.query(
      "insert into auth.users (id, email, raw_user_meta_data, invited_at, last_sign_in_at) values ($1, $2, $3, $4, $5)",
      [id, `${name.toLowerCase()}@example.org`, JSON.stringify({ full_name: name }), name === "CA_USER" ? "2026-10-01" : null, null]
    )
  }
  await db.query(
    `insert into public.projects (id, code, title, sample_type, frequency, kit_id, user_tier)
     values ($1, 'PROJ-ADM', 'Admin project', 'wastewater', 'weekly', $3, 'under_20'),
            ($2, 'PROJ-Q', 'Other project', 'wastewater', 'weekly', $3, null)`,
    [P, Q, kitId]
  )
  await db.query(
    "insert into public.centres (id, project_id, name, active) values ($1, $3, 'Centre A', true), ($2, $3, 'Centre B', false)",
    [CA, CB, P]
  )
  await db.query(
    `insert into public.project_memberships (user_id, project_id, centre_id, role) values
       ($1, $5, null, 'project_admin'), ($2, $5, null, 'project_admin'),
       ($3, $5, $6, 'centre_user'), ($4, $7, null, 'project_admin')`,
    [U.ADMIN, U.ADMIN_B, U.CA_USER, U.Q_ADMIN, P, CA, Q]
  )
}, 60_000)

describe("user tier limit", () => {
  it("lets the admin add users up to the tier limit and refuses the next one", async () => {
    // 3 members already; under_20 allows 20 in total.
    const err = await errorOf(
      runAs(db, "authenticated", U.ADMIN, async (tx) => {
        await tx.query("set local role postgres")
        for (let i = 0; i < 18; i++) {
          await tx.query("insert into auth.users (id, email) values ($1, $2)", [extraUser(i), `x${i}@example.org`])
        }
        await tx.query("set local role authenticated")
        for (let i = 0; i < 17; i++) {
          await tx.query(
            "insert into public.project_memberships (user_id, project_id, centre_id, role) values ($1, $2, $3, 'centre_user')",
            [extraUser(i), P, CA]
          )
        }
        const { rows } = await tx.query<{ n: number }>(
          "select count(*)::int as n from public.project_memberships where project_id = $1",
          [P]
        )
        expect(rows[0].n).toBe(20)
        await tx.query(
          "insert into public.project_memberships (user_id, project_id, centre_id, role) values ($1, $2, $3, 'centre_user')",
          [extraUser(17), P, CA]
        )
      })
    )
    expect(err.message).toMatch(/limit of 20 users/)
  })

  it("does not limit projects without a tier", async () => {
    await runAs(db, "authenticated", U.Q_ADMIN, async (tx) => {
      await tx.query("set local role postgres")
      await tx.query("insert into auth.users (id, email) values ($1, 'q@example.org')", [extraUser(50)])
      await tx.query("set local role authenticated")
      await tx.query(
        "insert into public.project_memberships (user_id, project_id, role) values ($1, $2, 'project_admin')",
        [extraUser(50), Q]
      )
    })
  })

  it("maps every onboarding tier to the limits the app shows", async () => {
    const { rows } = await db.query<{ tier: string; n: number | null }>(
      "select t as tier, private.user_tier_limit(t) as n from unnest(array['under_20','20_to_50','50_to_100','over_100']) t"
    )
    expect(Object.fromEntries(rows.map((r) => [r.tier, r.n]))).toEqual({
      under_20: 20,
      "20_to_50": 50,
      "50_to_100": 100,
      over_100: null,
    })
  })
})

describe("at least one project admin", () => {
  it("refuses to remove or demote the only admin", async () => {
    const removeErr = await errorOf(
      runAs(db, "authenticated", U.Q_ADMIN, (tx) =>
        tx.query("delete from public.project_memberships where user_id = $1 and project_id = $2", [U.Q_ADMIN, Q])
      )
    )
    expect(removeErr.message).toMatch(/at least one project admin/)
  })

  it("allows removing or demoting an admin while another remains", async () => {
    await runAs(db, "authenticated", U.ADMIN, async (tx) => {
      await tx.query(
        "update public.project_memberships set role = 'centre_user', centre_id = $3 where user_id = $1 and project_id = $2",
        [U.ADMIN_B, P, CA]
      )
      const err = await tx
        .query("delete from public.project_memberships where user_id = $1 and project_id = $2", [U.ADMIN, P])
        .catch((e: Error) => e)
      expect((err as Error).message).toMatch(/at least one project admin/)
    })
    await runAs(db, "authenticated", U.ADMIN, (tx) =>
      tx.query("delete from public.project_memberships where user_id = $1 and project_id = $2", [U.ADMIN_B, P])
    )
  })

  it("still lets a whole project be deleted", async () => {
    await runAs(db, "service_role", null, (tx) => tx.query("delete from public.projects where id = $1", [Q]))
  })
})

describe("project_member_directory", () => {
  it("gives the project admin names, emails, centres and invite state", async () => {
    const { rows } = await as<{ email: string; role: string; centre_name: string | null; invited_at: unknown }>(
      U.ADMIN,
      "select * from public.project_member_directory($1)",
      [P]
    )
    expect(rows.map((r) => r.email)).toEqual(["admin@example.org", "admin_b@example.org", "ca_user@example.org"])
    expect(rows[2]).toMatchObject({ role: "centre_user", centre_name: "Centre A" })
    expect(rows[2].invited_at).not.toBeNull()
  })

  it("refuses centre users and admins of other projects", async () => {
    expect((await errorOf(as(U.CA_USER, "select * from public.project_member_directory($1)", [P]))).message).toMatch(
      /Only a project admin/
    )
    expect((await errorOf(as(U.Q_ADMIN, "select * from public.project_member_directory($1)", [P]))).message).toMatch(
      /Only a project admin/
    )
  })
})

describe("auth_user_id_by_email", () => {
  it("is only callable by the service role", async () => {
    const err = await errorOf(as(U.ADMIN, "select public.auth_user_id_by_email('ca_user@example.org')"))
    expect(err.message).toMatch(/permission denied/)
    const { rows } = await runAs(db, "service_role", null, (tx) =>
      tx.query<{ id: string }>("select public.auth_user_id_by_email('  CA_User@Example.org ') as id")
    )
    expect(rows[0].id).toBe(U.CA_USER)
  })
})

describe("project_centre_activity", () => {
  it("counts uploads this month, pending approvals and the last upload per centre", async () => {
    // Insert as the owner, then read as the admin, in one rolled-back transaction.
    const rows = await runAs(db, "authenticated", U.ADMIN, async (tx) => {
      await tx.query("set local role postgres")
      const now = new Date().toISOString()
      for (const [status, approval, at] of [
        ["compiled", "pending", now],
        ["approved", "approved", now],
        ["draft", "pending", now],
        ["compiled", "pending", "2020-01-15T00:00:00Z"],
      ]) {
        await tx.query(
          `insert into public.upload_batches (project_id, centre_id, uploaded_by, upload_status, approval_status, submitted_at, created_at)
           values ($1, $2, $3, $4, $5, $6, $6)`,
          [P, CA, U.CA_USER, status, approval, at]
        )
      }
      await tx.query("set local role authenticated")
      return (await tx.query("select * from public.project_centre_activity($1)", [P])).rows
    })
    expect(rows).toEqual([
      expect.objectContaining({ centre_name: "Centre A", active: true, users: 1, uploads_this_month: 2, pending_approvals: 2 }),
      expect.objectContaining({ centre_name: "Centre B", active: false, users: 0, uploads_this_month: 0, last_upload_at: null }),
    ])
    expect((rows[0] as { last_upload_at: unknown }).last_upload_at).not.toBeNull()
  })

  it("returns nothing to people outside the project", async () => {
    const { rows } = await as(U.Q_ADMIN, "select * from public.project_centre_activity($1)", [P])
    expect(rows).toEqual([])
  })
})

describe("project settings", () => {
  it("lets the admin edit details and records it", async () => {
    await runAs(db, "authenticated", U.ADMIN, async (tx) => {
      await tx.query("select public.update_project_details($1, $2)", [
        P,
        JSON.stringify({ title: "  Renamed  ", objective: "", frequency: "monthly", start_date: "2026-01-01", end_date: "" }),
      ])
      const { rows } = await tx.query<{ title: string; objective: string | null; frequency: string }>(
        "select title, objective, frequency from public.projects where id = $1",
        [P]
      )
      expect(rows[0]).toEqual({ title: "Renamed", objective: null, frequency: "monthly" })
      const audit = await tx.query("select 1 from public.audit_events where event_type = 'project.details_updated'")
      expect(audit.rows).toHaveLength(1)
    })
  })

  it("refuses centre users and blank titles", async () => {
    const details = JSON.stringify({ title: "X", frequency: "weekly" })
    expect((await errorOf(as(U.CA_USER, "select public.update_project_details($1, $2)", [P, details]))).code).toBe("42501")
    const blank = JSON.stringify({ title: "  ", frequency: "weekly" })
    expect((await errorOf(as(U.ADMIN, "select public.update_project_details($1, $2)", [P, blank]))).code).toBe("22023")
  })

  it("changes the kit, layout and rules together until data exists", async () => {
    await runAs(db, "authenticated", U.ADMIN, async (tx) => {
      await tx.query("select public.change_project_kit($1, $2, $3, $4, $5)", [P, otherKitId, "{}", "{}", "{}"])
      const { rows } = await tx.query<{ kit_id: string }>("select kit_id from public.projects where id = $1", [P])
      expect(rows[0].kit_id).toBe(otherKitId)
    })
  })

  it("locks the kit once any upload exists", async () => {
    const err = await errorOf(
      runAs(db, "authenticated", U.ADMIN, async (tx) => {
        await tx.query("set local role postgres")
        await tx.query(
          "insert into public.upload_batches (project_id, centre_id, uploaded_by) values ($1, $2, $3)",
          [P, CA, U.CA_USER]
        )
        await tx.query("set local role authenticated")
        await tx.query("select public.change_project_kit($1, $2, '{}', '{}', '{}')", [P, otherKitId])
      })
    )
    expect(err.message).toMatch(/cannot be changed once centres have uploaded/)
  })

  it("refuses kit changes from centre users", async () => {
    const err = await errorOf(as(U.CA_USER, "select public.change_project_kit($1, $2, '{}', '{}', '{}')", [P, otherKitId]))
    expect(err.code).toBe("42501")
  })
})

describe("retired kits", () => {
  it("stay readable, with their targets, to members of a project that uses them", async () => {
    const counts = await runAs(db, "authenticated", U.CA_USER, async (tx) => {
      await tx.query("set local role postgres")
      await tx.query("update public.kits set active = false where id = $1", [kitId])
      await tx.query("set local role authenticated")
      const kits = await tx.query("select id from public.kits where id = $1", [kitId])
      const targets = await tx.query("select id from public.kit_targets where kit_id = $1", [kitId])
      return { kits: kits.rows.length, targets: targets.rows.length }
    })
    expect(counts.kits).toBe(1)
    expect(counts.targets).toBeGreaterThan(0)
  })

  it("stay hidden from people outside those projects", async () => {
    const counts = await runAs(db, "authenticated", U.Q_ADMIN, async (tx) => {
      await tx.query("set local role postgres")
      await tx.query("update public.kits set active = false where id = $1", [kitId])
      await tx.query("update public.projects set kit_id = $1 where id = $2", [otherKitId, Q])
      await tx.query("set local role authenticated")
      return (await tx.query("select id from public.kits where id = $1", [kitId])).rows.length
    })
    expect(counts).toBe(0)
  })
})

describe("create_announcement", () => {
  const call = "select public.create_announcement($1, $2, $3, $4, $5::uuid[]) as id"

  it("publishes to selected centres in one go", async () => {
    await runAs(db, "authenticated", U.ADMIN, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(call, [P, " Hello ", "Body", "selected_centres", [CA, CA]])
      const targets = await tx.query("select centre_id from public.announcement_centres where announcement_id = $1", [
        rows[0].id,
      ])
      expect(targets.rows).toEqual([{ centre_id: CA }])
      const ann = await tx.query<{ title: string }>("select title from public.announcements where id = $1", [rows[0].id])
      expect(ann.rows[0].title).toBe("Hello")
    })
  })

  it("refuses inactive centres, empty selections and centres with an all-centres audience", async () => {
    expect((await errorOf(as(U.ADMIN, call, [P, "T", "B", "selected_centres", [CB]]))).message).toMatch(/not active/)
    expect((await errorOf(as(U.ADMIN, call, [P, "T", "B", "selected_centres", []]))).message).toMatch(/at least one/)
    expect((await errorOf(as(U.ADMIN, call, [P, "T", "B", "all_centres", [CA]]))).message).toMatch(/Do not select/)
  })

  it("refuses centre users", async () => {
    const err = await errorOf(as(U.CA_USER, call, [P, "T", "B", "all_centres", []]))
    expect(err.message).toMatch(/row-level security/)
  })
})
