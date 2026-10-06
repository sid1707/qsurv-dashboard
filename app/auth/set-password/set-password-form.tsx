"use client"

import { useActionState } from "react"
import { setPasswordAction, type SetPasswordState } from "./actions"
import { Field, inputClass } from "@/components/project-admin/form"
import { Button } from "@/components/ui/button"

const IDLE: SetPasswordState = { status: "idle" }

export function SetPasswordForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(setPasswordAction, IDLE)

  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field id="password" label="New password" hint="(at least 10 characters)">
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={10}
          maxLength={72}
          autoComplete="new-password"
          className={inputClass}
        />
      </Field>
      <Field id="confirmPassword" label="Confirm password">
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          autoComplete="new-password"
          className={inputClass}
        />
      </Field>
      {state.status === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Saving..." : "Save password and continue"}
      </Button>
    </form>
  )
}
