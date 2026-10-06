import Link from "next/link"
import { SetPasswordForm } from "./set-password-form"
import { safeNextPath } from "@/lib/auth/invite"
import { createClient } from "@/lib/supabase/server"

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { next } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center p-6">
      <section className="w-full rounded-lg border bg-card p-6">
        <h1 className="text-2xl font-semibold">Choose a password</h1>
        {user ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              You will sign in to QSurv as <span className="font-medium text-foreground">{user.email}</span>.
            </p>
            <SetPasswordForm next={safeNextPath(typeof next === "string" ? next : null)} />
          </>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Your invite session has expired. Open the link in your invite email again, or{" "}
            <Link href="/login" className="underline underline-offset-4">
              sign in
            </Link>
            .
          </p>
        )}
      </section>
    </main>
  )
}
