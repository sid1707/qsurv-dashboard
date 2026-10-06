import type { PGlite, Transaction } from "@electric-sql/pglite"
import { beforeAll, describe, expect, it } from "vitest"
import { createMigratedDb, runAs } from "./harness"

// Project P: admins ADMIN and ADMIN_B, centre user CA_USER (centre CA), and
// NEWBIE with no membership yet. Project Q has admin Q_ADMIN.
const U = {
  ADMIN: "00000000-0000-4000-8000-0000000000c1",
  ADMIN_B: "00000000-0000-4000-8000-0000000000c2",
  CA_USER: "00000000-0000-4000-8000-0000000000c3",
  Q_ADMIN: "00000000-0000-4000-8000-0000000000c4",
  NEWBIE: "00000000-0000-4000-8000-0000000000c5",
  SUPER: "00000000-0000-4000-8000-0000000000c6",
}
const P = "10000000-0000-4000-8000-0000000000c1"
const Q = "10000000-0000-4000-8000-0000000000c2"
const CA = "20000000-0000-4000-8000-0000000000c1"
const CB = "20000000-0000-4000-8000-0000000000c2"

let db: PGlite

type AuditRow = { event_type: string; actor_user_id: string | null; actor_role: string | null; entity_id: string; payload: Record<string, unknown> }

/** Audit rows written by fn, read back as postgres so RLS does not hide any. */
async function auditedBy(tx: Transaction, fn: () => Promise<unknown>) {
  await tx.query("set local role postgres")
  const { rows: before } = await tx.query<{ n: number }>("select coalesce(max(id), 0)::int as n from public.audit_events")
  await tx.query("set local role authenticated")
  await fn()
  await tx.query("set local role postgres")
  const { rows } = await tx.query<AuditRow>(
    "select event_type, actor_user_id, actor_role, entity_id, payload from public.audit_events where id > $1 order by id",
    [before[0].n]
  )
  return rows
}

async function errorOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error as { message: string }
  }
  throw new Error("Expected the query to fail")
}

beforeAll(async () => {
  db = await createMigratedDb()
  const kit = await db.query<{ id: string }>("select id from public.kits where active order by name limit 1")
  for (const [name, id] of Object.entries(U)) {
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${name.toLowerCase()}@example.org`])
  }
  await db.query("update public.profiles set is_super_admin = true where user_id = $1", [U.SUPER])
  await db.query(
    `insert into public.projects (id, code, title, sample_type, frequency, kit_id)
     values ($1, 'AUD-P', 'Audit project', 'wastewater', 'weekly', $3),
            ($2, 'AUD-Q', 'Other project', 'wastewater', 'weekly', $3)`,
    [P, Q, kit.rows[0].id]
  )
  await db.query("insert into public.centres (id, project_id, name) values ($1, $3, 'Centre A'), ($2, $3, 'Centre B')", [CA, CB, P])
  await db.query(
    `insert into public.project_memberships (user_id, project_id, centre_id, role) values
       ($1, $5, null, 'project_admin'), ($2, $5, null, 'project_admin'),
       ($3, $5, $6, 'centre_user'), ($4, $7, null, 'project_admin')`,
    [U.ADMIN, U.ADMIN_B, U.CA_USER, U.Q_ADMIN, P, CA, Q]
  )
}, 60_000)

describe("membership changes are audited by the database", () => {
  it("records an invite (new membership) with the admin as actor", async () => {
    const rows = await runAs(db, "authenticated", U.ADMIN, (tx) =>
      auditedBy(tx, () =>
        tx.query("insert into public.project_memberships (user_id, project_id, centre_id, role) values ($1, $2, $3, 'centre_user')", [
          U.NEWBIE, P, CA,
        ])
      )
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      event_type: "membership.added",
      actor_user_id: U.ADMIN,
      actor_role: "project_admin",
      entity_id: U.NEWBIE,
      payload: { role: "centre_user", centre_id: CA },
    })
  })

  it("records a role change with the old and new role", async () => {
    const rows = await runAs(db, "authenticated", U.ADMIN, (tx) =>
      auditedBy(tx, () =>
        tx.query("update public.project_memberships set role = 'project_admin', centre_id = null where user_id = $1 and project_id = $2", [
          U.CA_USER, P,
        ])
      )
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      event_type: "membership.role_changed",
      actor_user_id: U.ADMIN,
      entity_id: U.CA_USER,
      payload: { from_role: "centre_user", to_role: "project_admin", from_centre_id: CA, to_centre_id: null },
    })
  })

  it("records a move to another centre", async () => {
    const rows = await runAs(db, "authenticated", U.ADMIN, (tx) =>
      auditedBy(tx, () =>
        tx.query("update public.project_memberships set centre_id = $3 where user_id = $1 and project_id = $2", [U.CA_USER, P, CB])
      )
    )
    expect(rows.map((r) => r.event_type)).toEqual(["membership.centre_changed"])
  })

  it("records a self-demotion as done by a project admin", async () => {
    const rows = await runAs(db, "authenticated", U.ADMIN_B, (tx) =>
      auditedBy(tx, () =>
        tx.query("update public.project_memberships set role = 'centre_user', centre_id = $3 where user_id = $1 and project_id = $2", [
          U.ADMIN_B, P, CA,
        ])
      )
    )
    expect(rows[0]).toMatchObject({ event_type: "membership.role_changed", actor_role: "project_admin" })
  })

  it("records a removal", async () => {
    const rows = await runAs(db, "authenticated", U.ADMIN, (tx) =>
      auditedBy(tx, () => tx.query("delete from public.project_memberships where user_id = $1 and project_id = $2", [U.CA_USER, P]))
    )
    expect(rows[0]).toMatchObject({ event_type: "membership.removed", entity_id: U.CA_USER, payload: { role: "centre_user" } })
  })

  it("records a super admin's change as super_admin", async () => {
    const rows = await runAs(db, "authenticated", U.SUPER, (tx) =>
      auditedBy(tx, () => tx.query("delete from public.project_memberships where user_id = $1 and project_id = $2", [U.CA_USER, P]))
    )
    expect(rows[0]).toMatchObject({ actor_user_id: U.SUPER, actor_role: "super_admin" })
  })

  it("records nothing when nothing changed", async () => {
    const rows = await runAs(db, "authenticated", U.ADMIN, (tx) =>
      auditedBy(tx, () => tx.query("update public.project_memberships set role = role where project_id = $1", [P]))
    )
    expect(rows).toEqual([])
  })

  it("still lets a whole project or user be deleted", async () => {
    await runAs(db, "service_role", null, async (tx) => {
      await tx.query("set local role postgres")
      await tx.query("delete from auth.users where id = $1", [U.CA_USER])
      await tx.query("delete from public.projects where id = $1", [P])
      const { rows } = await tx.query("select 1 from public.audit_events where project_id = $1", [P])
      expect(rows).toEqual([])
    })
  })
})

describe("who may write audit events through the API", () => {
  const insert = (tx: Transaction, actor: string, project: string | null, eventType: string) =>
    tx.query(
      "insert into public.audit_events (project_id, actor_user_id, event_type, entity_type, entity_id) values ($1, $2, $3, 'centre', 'x')",
      [project, actor, eventType]
    )

  it("lets a project admin record an app event for their project", async () => {
    await runAs(db, "authenticated", U.ADMIN, (tx) => insert(tx, U.ADMIN, P, "centre.created"))
  })

  it("refuses centre users", async () => {
    const err = await errorOf(runAs(db, "authenticated", U.CA_USER, (tx) => insert(tx, U.CA_USER, P, "centre.created")))
    expect(err.message).toMatch(/row-level security/)
  })

  it("refuses events the database records itself", async () => {
    for (const type of ["membership.removed", "project_request.approved", "project.details_updated", "kit.saved"]) {
      const err = await errorOf(runAs(db, "authenticated", U.ADMIN, (tx) => insert(tx, U.ADMIN, P, type)))
      expect(err.message, type).toMatch(/row-level security/)
    }
  })

  it("refuses another project, another actor, and global events from non-super-admins", async () => {
    for (const [actor, project] of [[U.ADMIN, Q], [U.ADMIN_B, P], [U.ADMIN, null]] as const) {
      const err = await errorOf(runAs(db, "authenticated", U.ADMIN, (tx) => insert(tx, actor, project, "centre.created")))
      expect(err.message).toMatch(/row-level security/)
    }
  })
})
