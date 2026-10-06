import Link from "next/link"
import { buttonVariants } from "@/components/ui/button"
import { projectDashboardPath, roleLabel } from "@/lib/auth/access"
import { requireUserContext } from "@/lib/auth/context"
import { createClient } from "@/lib/supabase/server"

type ProjectCard = {
  code: string
  title: string
  status: string
  detail: string | null
}

export default async function ProjectsPage() {
  const context = await requireUserContext()

  let cards: ProjectCard[] = context.projects.map((p) => ({
    code: p.code,
    title: p.title,
    status: p.status,
    detail: p.centreName ? `${roleLabel(p.role)} · ${p.centreName}` : roleLabel(p.role),
  }))

  // Super admins can open any project, member or not.
  if (context.isSuperAdmin) {
    const supabase = await createClient()
    const { data } = await supabase.from("projects").select("code, title, status").order("title")
    const memberCodes = new Set(cards.map((c) => c.code))
    cards = [
      ...cards,
      ...(data ?? [])
        .filter((p) => !memberCodes.has(p.code))
        .map((p) => ({ code: p.code, title: p.title, status: p.status, detail: null })),
    ]
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Your projects</h1>
      {cards.length === 0 ? (
        <div className="mt-6 max-w-xl rounded-lg border p-6">
          <p className="font-medium">You are not part of any project yet.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            If you requested a project, you will get access once it is approved. If you work at a
            partner centre, ask your nodal lab to add you.
          </p>
          <Link href="/onboarding" className={buttonVariants({ variant: "outline", className: "mt-4" })}>
            Request a project
          </Link>
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <li key={card.code}>
              <Link
                href={projectDashboardPath(card.code)}
                className="block h-full rounded-lg border bg-card p-5 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold">{card.title}</h2>
                  {card.status !== "active" ? (
                    <span className="rounded-md border px-1.5 py-0.5 text-xs capitalize text-muted-foreground">
                      {card.status}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{card.code}</p>
                {card.detail ? <p className="mt-3 text-sm text-muted-foreground">{card.detail}</p> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
