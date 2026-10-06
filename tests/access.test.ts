import { describe, expect, it } from "vitest"
import {
  projectAdminPath,
  projectCentrePath,
  projectDashboardPath,
  projectHomePath,
  resolveHomePath,
  toProjectAccess,
  type MembershipRow,
  type ProjectAccess,
} from "../lib/auth/access"

function project(code: string): ProjectAccess {
  return {
    projectId: `id-${code}`,
    code,
    title: `Project ${code}`,
    status: "active",
    role: "centre_user",
    centreId: "c1",
    centreName: "Centre 1",
  }
}

describe("resolveHomePath", () => {
  it("sends super admins to /super-admin, even with project memberships", () => {
    expect(resolveHomePath({ isSuperAdmin: true, projects: [project("P1")] })).toBe("/super-admin")
  })

  it("sends a centre user with one project to that project's centre workspace", () => {
    expect(resolveHomePath({ isSuperAdmin: false, projects: [project("WW-DELHI")] })).toBe(
      "/p/WW-DELHI/centre"
    )
  })

  it("sends a project admin with one project to that project's admin dashboard", () => {
    const admin = { ...project("WW-DELHI"), role: "project_admin" as const, centreId: null, centreName: null }
    expect(resolveHomePath({ isSuperAdmin: false, projects: [admin] })).toBe("/p/WW-DELHI/admin")
  })

  it("sends a user with several projects to the picker", () => {
    expect(
      resolveHomePath({ isSuperAdmin: false, projects: [project("P1"), project("P2")] })
    ).toBe("/projects")
  })

  it("sends a user with no projects to the picker, which explains what to do", () => {
    expect(resolveHomePath({ isSuperAdmin: false, projects: [] })).toBe("/projects")
  })
})

describe("project paths", () => {
  it("encodes the project code", () => {
    expect(projectDashboardPath("A B")).toBe("/p/A%20B")
  })

  it("builds admin and centre page paths", () => {
    expect(projectAdminPath("RBL-AMR")).toBe("/p/RBL-AMR/admin")
    expect(projectAdminPath("RBL-AMR", "users")).toBe("/p/RBL-AMR/admin/users")
    expect(projectCentrePath("RBL-AMR", "uploads")).toBe("/p/RBL-AMR/centre/uploads")
  })

  it("opens the workspace for the member's role", () => {
    expect(projectHomePath({ code: "X1", role: "project_admin" })).toBe("/p/X1/admin")
    expect(projectHomePath({ code: "X1", role: "centre_user" })).toBe("/p/X1/centre")
  })
})

describe("toProjectAccess", () => {
  it("flattens embedded project and centre rows and sorts by title", () => {
    const rows: MembershipRow[] = [
      {
        role: "centre_user",
        centre_id: "c1",
        project: { id: "p2", code: "ZED", title: "Zed project", status: "active" },
        centre: [{ name: "Centre One" }],
      },
      {
        role: "project_admin",
        centre_id: null,
        project: [{ id: "p1", code: "ALPHA", title: "Alpha project", status: "suspended" }],
        centre: null,
      },
    ]
    expect(toProjectAccess(rows)).toEqual([
      {
        projectId: "p1",
        code: "ALPHA",
        title: "Alpha project",
        status: "suspended",
        role: "project_admin",
        centreId: null,
        centreName: null,
      },
      {
        projectId: "p2",
        code: "ZED",
        title: "Zed project",
        status: "active",
        role: "centre_user",
        centreId: "c1",
        centreName: "Centre One",
      },
    ])
  })

  it("skips memberships whose project is not visible", () => {
    expect(
      toProjectAccess([{ role: "centre_user", centre_id: "c1", project: null, centre: null }])
    ).toEqual([])
  })
})
