import type { Metadata } from "next"
import Link from "next/link"
import { QSurvLogo } from "@/components/brand/logo"
import { OnboardingFormLoader } from "@/components/onboarding/onboarding-form-loader"
import { listActiveKits, type KitSummary } from "@/lib/kits/public"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = {
  title: "Request a project · QSurv",
}

async function loadKits(): Promise<KitSummary[]> {
  try {
    return await listActiveKits(await createClient())
  } catch {
    return []
  }
}

export default async function OnboardingPage() {
  const kits = await loadKits()

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 py-3 md:px-6">
          <Link href="/" aria-label="QSurv home">
            <QSurvLogo size={28} />
          </Link>
          <Link href="/login" className="text-sm underline-offset-4 hover:underline">
            Already approved? Sign in
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 md:px-6">
        <h1 className="text-2xl font-semibold">Request a project</h1>
        <p className="mt-2 text-muted-foreground">
          Tell us about your nodal lab and project. Your progress is saved in this browser, except
          your password.
        </p>
        <OnboardingFormLoader kits={kits} />
      </main>
    </div>
  )
}
