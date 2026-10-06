"use server"

import { headers } from "next/headers"
import { checkShortCode, submitOnboarding, type SubmitResult } from "@/lib/onboarding/submit"
import { clientIp, hashRateLimitKey } from "@/lib/security/rate-limit"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

async function deps() {
  return {
    service: createServiceRoleClient(),
    clientKeyHash: hashRateLimitKey(clientIp(await headers())),
  }
}

export async function checkShortCodeAction(code: unknown) {
  return checkShortCode(code, await deps())
}

/** On success the client clears its draft and navigates to /onboarding/received. */
export async function submitOnboardingAction(input: unknown): Promise<SubmitResult> {
  return submitOnboarding(input, await deps())
}
