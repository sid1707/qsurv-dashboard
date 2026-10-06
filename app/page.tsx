import Image from "next/image"
import Link from "next/link"
import { BarChart3, Database, FlaskConical, Layers, ShieldCheck } from "lucide-react"
import { QSurvLogo } from "@/components/brand/logo"
import { buttonVariants } from "@/components/ui/button"
import { listActiveKits, type KitSummary } from "@/lib/kits/public"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

const STEPS = [
  {
    title: "Request a project",
    body: "Your nodal lab fills in the onboarding form: objective, sample type, sampling frequency, kit and participating centres.",
  },
  {
    title: "Get approved",
    body: "The QSurv team reviews the request and sets up a private workspace for your project and its centres.",
  },
  {
    title: "Centres upload, you analyse",
    body: "Centres upload their qPCR run files. Your lab validates, approves, compiles and plots the results.",
  },
]

const FEATURES = [
  {
    icon: ShieldCheck,
    title: "Automatic validation",
    body: "Every run file is checked against the kit's plate layout, controls and Ct ranges before it reaches your data.",
  },
  {
    icon: Database,
    title: "Data management",
    body: "Track every upload by centre and date, review issues, and approve or reject submissions.",
  },
  {
    icon: Layers,
    title: "Data compilation",
    body: "Approved runs are compiled into one clean dataset across all centres.",
  },
  {
    icon: BarChart3,
    title: "Data plotting",
    body: "Trends by target, centre and date, so the whole network's signal is visible at a glance.",
  },
]

async function loadKits(): Promise<KitSummary[] | null> {
  try {
    return await listActiveKits(await createClient())
  } catch {
    return null
  }
}

export default async function LandingPage() {
  const kits = await loadKits()

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 md:px-6">
          <QSurvLogo size={30} priority />
          <nav className="flex items-center gap-2">
            <Link href="/login" className={buttonVariants({ variant: "ghost" })}>
              Sign in
            </Link>
            <Link href="/onboarding" className={buttonVariants()}>
              Request a project
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-16 md:grid-cols-[1.4fr_1fr] md:px-6 md:py-24">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Multicentre qPCR surveillance</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance md:text-5xl">
              One portal for your surveillance network&apos;s qPCR data.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground text-pretty">
              QSurv gives a nodal lab a private workspace where partner centres upload qPCR run
              files and your team validates, approves, compiles and plots the results.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/onboarding" className={buttonVariants({ size: "lg" })}>
                Request a project
              </Link>
              <Link href="/login" className={buttonVariants({ variant: "outline", size: "lg" })}>
                Sign in
              </Link>
            </div>
          </div>
          <div className="hidden justify-center md:flex">
            <Image src="/qsurv-logo.png" alt="" width={300} height={267} priority />
          </div>
        </section>

        <section className="border-y bg-muted/40">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 md:px-6">
            <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
            <ol className="mt-8 grid gap-6 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="rounded-lg border bg-card p-6">
                  <span className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                    {index + 1}
                  </span>
                  <h3 className="mt-4 font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 py-16 md:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">Kits</h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Each project runs on one fixed kit panel, so every centre uses the same targets,
            controls and plate layout.
          </p>
          <KitList kits={kits} />
        </section>

        <section className="border-t bg-muted/40">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 md:px-6">
            <h2 className="text-2xl font-semibold tracking-tight">Analysis features</h2>
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <div key={title} className="rounded-lg border bg-card p-6">
                  <Icon className="size-5 text-muted-foreground" aria-hidden />
                  <h3 className="mt-4 font-semibold">{title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto flex w-full max-w-6xl flex-col items-start gap-4 px-4 py-16 md:flex-row md:items-center md:justify-between md:px-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Ready to start a project?</h2>
            <p className="mt-2 text-muted-foreground">
              Tell us about your network and the QSurv team will review your request.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/onboarding" className={buttonVariants({ size: "lg" })}>
              Request a project
            </Link>
            <Link href="/login" className={buttonVariants({ variant: "outline", size: "lg" })}>
              Sign in
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-6 text-sm text-muted-foreground md:px-6">
          <QSurvLogo size={20} />
          <span>Multicentre qPCR surveillance portal</span>
        </div>
      </footer>
    </div>
  )
}

function KitList({ kits }: { kits: KitSummary[] | null }) {
  if (kits === null) {
    return (
      <p className="mt-8 rounded-lg border p-6 text-sm text-muted-foreground">
        Kit details are unavailable right now. You can still request a project.
      </p>
    )
  }
  if (kits.length === 0) {
    return (
      <p className="mt-8 rounded-lg border p-6 text-sm text-muted-foreground">
        No kits are available yet.
      </p>
    )
  }
  return (
    <div className={cn("mt-8 grid gap-6", kits.length > 1 && "md:grid-cols-2")}>
      {kits.map((kit) => (
        <div key={kit.id} className="rounded-lg border bg-card p-6">
          <div className="flex items-start gap-3">
            <FlaskConical className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
            <div>
              <h3 className="font-semibold">{kit.name}</h3>
              <p className="text-xs text-muted-foreground">Version {kit.version}</p>
            </div>
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Targets</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {kit.targets.map((t) => (
                  <span key={t.name} className="rounded-md border px-2 py-0.5">
                    {t.name} <span className="text-muted-foreground">· {t.fluorophore}</span>
                  </span>
                ))}
              </dd>
            </div>
            {kit.controls.length > 0 ? (
              <div>
                <dt className="text-muted-foreground">Controls</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {kit.controls.map((t) => (
                    <span key={t.name} className="rounded-md border px-2 py-0.5">
                      {t.name} <span className="text-muted-foreground">· {t.fluorophore}</span>
                    </span>
                  ))}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      ))}
    </div>
  )
}
