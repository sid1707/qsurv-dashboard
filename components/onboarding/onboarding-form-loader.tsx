"use client"

import dynamic from "next/dynamic"
import type { KitSummary } from "@/lib/kits/public"

// Client-only so the saved draft can seed the initial state without a hydration mismatch.
const OnboardingForm = dynamic(
  () => import("@/components/onboarding/onboarding-form").then((m) => m.OnboardingForm),
  {
    ssr: false,
    loading: () => <div className="mt-8 h-96 animate-pulse rounded-lg border bg-muted/40" />,
  }
)

export function OnboardingFormLoader({ kits }: { kits: KitSummary[] }) {
  return <OnboardingForm kits={kits} />
}
