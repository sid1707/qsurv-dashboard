import type { USER_TIERS } from "@/lib/onboarding/schema"

type UserTier = (typeof USER_TIERS)[number]["value"]

/**
 * Most users (admins and centre users together) each onboarding tier allows,
 * the upper bound of the tier. Null means no limit. The database enforces the
 * same numbers in private.user_tier_limit; tests check the two agree.
 */
export const USER_TIER_LIMITS: Record<UserTier, number | null> = {
  under_20: 20,
  "20_to_50": 50,
  "50_to_100": 100,
  over_100: null,
}

export function userLimit(tier: string | null): number | null {
  if (!tier || !(tier in USER_TIER_LIMITS)) return null
  return USER_TIER_LIMITS[tier as UserTier]
}

export type Seats = { used: number; limit: number | null; remaining: number | null; full: boolean }

export function seatSummary(used: number, tier: string | null): Seats {
  const limit = userLimit(tier)
  if (limit === null) return { used, limit, remaining: null, full: false }
  const remaining = Math.max(0, limit - used)
  return { used, limit, remaining, full: remaining === 0 }
}
