"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Button } from "@/components/ui/button"
import { signInWithPasswordAction } from "./actions"

const INITIAL_STATE = { status: "idle" as const, message: "" }

function SignInButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Signing in..." : "Sign in"}
    </Button>
  )
}

export default function LoginPage() {
  const [state, formAction] = useActionState(signInWithPasswordAction, INITIAL_STATE)

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center p-6">
      <section className="w-full rounded-lg border bg-card p-6">
        <h1 className="text-2xl font-semibold">QSurv Portal Login</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in with the email and password provisioned for your account.
        </p>

        <form action={formAction} className="mt-6 space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="name@institute.org"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {state.message ? (
            <p
              className={`text-sm ${
                state.status === "error" ? "text-destructive" : "text-emerald-600"
              }`}
            >
              {state.message}
            </p>
          ) : null}

          <SignInButton />
        </form>
      </section>
    </main>
  )
}
