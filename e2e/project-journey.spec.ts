import path from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { E2E_KIT, MAILPIT_URL, SUPER_ADMIN, serviceClient } from "./env"

/**
 * The whole QSurv journey, one step per test, each in a fresh browser (so
 * signed out): a nodal lab requests a project, the super admin approves it,
 * the project admin invites a centre user, the centre user uploads a run, and
 * the admin approves it and finds it in the compiled data.
 */
test.describe.configure({ mode: "serial" })

const RUN_FILE = path.resolve(__dirname, "../tests/fixtures/runs/C01_HuwelLab_Pune_01102026_quantstudio5.csv")
const RUN_DATE = "01/10/2026"

// Unique per run so the suite can be repeated against the same database.
const stamp = Date.now().toString(36).toUpperCase().slice(-5)
const PROJECT_CODE = `E2E-${stamp}`
const ADMIN = { name: "E2E Nodal Admin", email: `e2e-admin-${stamp.toLowerCase()}@qsurv.test`, password: "e2e-admin-password" }
const CENTRE_USER = { name: "E2E Centre User", email: `e2e-centre-${stamp.toLowerCase()}@qsurv.test`, password: "e2e-centre-password" }
const CENTRE = { name: "Huwel Lab", city: "Pune", id: "C01" }

async function signIn(page: Page, user: { email: string; password: string }) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(user.email)
  await page.getByLabel("Password").fill(user.password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

const next = (page: Page) => page.getByRole("button", { name: "Next" }).click()

/** The invite link from the newest email to this address in Mailpit. */
async function inviteLink(email: string) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const search = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
    const { messages } = (await search.json()) as { messages: { ID: string }[] }
    if (messages?.length) {
      const message = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${messages[0].ID}`)).json()) as { Text: string; HTML: string }
      const link = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/.exec(message.HTML || message.Text)?.[0]
      if (link) return link.replace(/&amp;/g, "&")
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`No invite email for ${email} arrived in Mailpit (${MAILPIT_URL}).`)
}

/** Audit rows for the project, read with the service role. */
async function auditEvents() {
  const service = serviceClient()
  const { data: project } = await service.from("projects").select("id").eq("code", PROJECT_CODE).single()
  const { data } = await service.from("audit_events").select("event_type").eq("project_id", project!.id)
  return (data ?? []).map((r) => r.event_type)
}

test("a nodal lab requests a project", async ({ page }) => {
  await page.goto("/onboarding")

  await page.getByLabel("Full name").fill(ADMIN.name)
  await page.getByLabel("Designation").fill("Scientist")
  await page.getByLabel("Email").fill(ADMIN.email)
  await page.getByLabel("Phone").fill("+91 20 5555 0100")
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password)
  await page.getByLabel("Confirm password").fill(ADMIN.password)
  await next(page)

  await page.getByLabel("Nodal lab or institute name").fill("E2E Nodal Lab")
  await page.getByLabel("City").fill("Pune")
  await page.getByLabel("State").fill("Maharashtra")
  await next(page)

  await page.getByLabel("Project title").fill(`E2E surveillance ${stamp}`)
  await page.getByLabel("Short code").fill(PROJECT_CODE)
  await page.getByLabel("Objective").fill("End-to-end test of the QSurv journey.")
  await page.getByLabel("Sample type").selectOption("wastewater")
  await page.getByLabel("Sampling frequency").selectOption("weekly")
  await next(page)

  await page.getByLabel("Multiplex kit").selectOption({ label: E2E_KIT.name })
  await page.getByLabel("QuantStudio 5").check()
  await page.getByLabel("Number of users").selectOption("under_20")
  await page.getByRole("button", { name: "Add centre" }).click()
  await page.locator("#centres\\.0\\.name").fill(CENTRE.name)
  await page.locator("#centres\\.0\\.city").fill(CENTRE.city)
  await next(page)

  // Plate layout and data rules: the kit's defaults.
  await expect(page.getByText("Step 5 of")).toBeVisible()
  await next(page)
  await expect(page.getByText("Step 6 of")).toBeVisible()
  await next(page)

  await page.getByLabel("Data management").check()
  await page.getByLabel("Data compilation").check()
  await page.getByLabel(/I agree to the QSurv terms of use/).check()
  await page.getByRole("button", { name: "Submit request" }).click()

  await expect(page).toHaveURL(/\/onboarding\/received/)

  // The account exists but stays blocked until approval.
  await page.goto("/login")
  await page.getByLabel("Email").fill(ADMIN.email)
  await page.getByLabel("Password").fill(ADMIN.password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByText(/waiting for approval/)).toBeVisible()
})

test("the super admin approves it", async ({ page }) => {
  const { data: request } = await serviceClient()
    .from("project_requests")
    .select("id")
    .eq("requested_code", PROJECT_CODE)
    .single()
  expect(request).not.toBeNull()

  await signIn(page, SUPER_ADMIN)
  await page.goto(`/super-admin/requests/${request!.id}`)
  await page.getByRole("button", { name: "Approve" }).click()
  await page.getByRole("button", { name: "Confirm approval" }).click()

  await expect(page.getByRole("status").filter({ hasText: "approved" })).toBeVisible()
  expect(await auditEvents()).toEqual(expect.arrayContaining(["project_request.approved", "membership.added"]))
})

test("the project admin invites a centre user", async ({ page }) => {
  await signIn(page, ADMIN)
  await page.goto(`/p/${PROJECT_CODE}/admin/users`)

  await page.getByLabel("Email").fill(CENTRE_USER.email)
  await page.getByLabel("Full name").fill(CENTRE_USER.name)
  await page.getByLabel("Role").selectOption("centre_user")
  await page.getByLabel("Centre", { exact: true }).selectOption({ label: CENTRE.name })
  await page.getByLabel("Centre ID for this centre").fill(CENTRE.id)
  await page.getByRole("button", { name: "Send invite" }).click()
  await expect(page.getByText(`Invite sent to ${CENTRE_USER.email}`)).toBeVisible()
  await expect(page.getByText("Invite pending")).toBeVisible()

  expect(await auditEvents()).toEqual(expect.arrayContaining(["user.invited", "centre.id_assigned"]))
})

test("the centre user accepts the invite and uploads a run", async ({ page }) => {
  await page.goto(await inviteLink(CENTRE_USER.email))
  await expect(page).toHaveURL(/\/auth\/set-password/)
  await page.getByLabel("New password").fill(CENTRE_USER.password)
  await page.getByLabel("Confirm password").fill(CENTRE_USER.password)
  await page.getByRole("button", { name: "Save password and continue" }).click()
  await expect(page).toHaveURL(new RegExp(`/p/${PROJECT_CODE}`))

  await page.goto(`/p/${PROJECT_CODE}/centre/upload`)
  await page.getByLabel("Sample collection date").fill(RUN_DATE)
  await page.getByLabel("Results export").setInputFiles(RUN_FILE)
  await page.getByRole("button", { name: "Validate and upload" }).click()

  // Runs with warnings ask for a confirmation first.
  const confirm = page.getByRole("button", { name: "Confirm and upload" })
  const uploaded = page.waitForURL(new RegExp(`/p/${PROJECT_CODE}/centre/uploads/[0-9a-f-]{36}`), { timeout: 60_000 })
  if (await confirm.isVisible({ timeout: 5_000 }).catch(() => false)) {
    const curves = page.getByLabel(/I have checked the run file/)
    if (await curves.isVisible()) await curves.check()
    await confirm.click()
  }
  await uploaded
})

test("the admin approves the upload and sees the compiled data", async ({ page }) => {
  await signIn(page, ADMIN)
  await page.goto(`/p/${PROJECT_CODE}/admin/approvals`)
  await expect(page.getByText(CENTRE.name)).toBeVisible()
  await page.getByRole("button", { name: "Approve", exact: true }).click()
  await expect(page.getByText(CENTRE.name)).toBeHidden({ timeout: 30_000 })

  await page.goto(`/p/${PROJECT_CODE}/admin/compiled`)
  await expect(page.getByRole("heading", { name: "Compiled data" })).toBeVisible()
  const rows = page.getByRole("row").filter({ hasText: "Target A" })
  await expect(rows.first()).toBeVisible()
  await expect(rows.first()).toContainText(CENTRE.name)

  expect(await auditEvents()).toEqual(expect.arrayContaining(["upload.approved"]))
})
