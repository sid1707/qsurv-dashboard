"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { EmailOtpType } from "@supabase/supabase-js"
import { parseInviteLink, safeNextPath } from "@/lib/auth/invite"
import { createClient } from "@/lib/supabase/client"

/**
 * Where invite emails land. Signs the invited user in from whatever the link
 * carries, then asks them to choose a password. Runs in the browser because
 * the default Supabase template puts the tokens in the URL hash.
 */
export default function AcceptInvitePage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const href = window.location.href
    const next = safeNextPath(new URL(href).searchParams.get("next"))
    const link = parseInviteLink(href)
    const supabase = createClient()

    async function signIn(): Promise<string | null> {
      switch (link.kind) {
        case "error":
          return link.message
        case "session":
          return (await supabase.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken }))
            .error?.message ?? null
        case "token_hash":
          return (await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type as EmailOtpType })).error
            ?.message ?? null
        case "code":
          return (await supabase.auth.exchangeCodeForSession(link.code)).error?.message ?? null
      }
    }

    void signIn().then((message) => {
      if (message) setError(message)
      else router.replace(`/auth/set-password?next=${encodeURIComponent(next)}`)
    })
  }, [router])

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center p-6">
      <section className="w-full rounded-lg border bg-card p-6">
        <h1 className="text-2xl font-semibold">Join QSurv</h1>
        {error ? (
          <>
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Invite links work once and expire. Ask your project admin to invite you again, or{" "}
              <Link href="/login" className="underline underline-offset-4">
                sign in
              </Link>{" "}
              if you already set a password.
            </p>
          </>
        ) : (
          <p role="status" className="mt-3 text-sm text-muted-foreground">
            Checking your invite...
          </p>
        )}
      </section>
    </main>
  )
}
