"use client"

import { useActionState, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  changePasswordAction,
  deleteUploadAction,
  setAnnouncementDismissedAction,
  updateProfileAction,
} from "@/app/(app)/p/[code]/centre/actions"
import { Field, FormMessage, inputClass } from "@/components/project-admin/form"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import type { CentreAnnouncement } from "@/lib/announcements/queries"
import { formatDateTimeIso } from "@/lib/format"
import { IDLE, type ActionState } from "@/lib/project-admin/result"
import { cn } from "@/lib/utils"

export function DeleteUploadButton({ code, uploadId, label, after }: { code: string; uploadId: string; label: string; after?: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<ActionState>(IDLE)

  function remove() {
    startTransition(async () => {
      const result = await deleteUploadAction(code, uploadId)
      setMessage(result)
      if (result.status === "success" && after) router.push(after)
    })
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <AlertDialog>
        <AlertDialogTrigger render={<Button type="button" size="sm" variant="destructive" disabled={pending} />}>
          {pending ? "Deleting..." : "Delete"}
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this upload?</AlertDialogTitle>
            <AlertDialogDescription>
              {label} and its run file will be removed. You can upload the run again afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {message.status === "error" ? <FormMessage state={message} /> : null}
    </span>
  )
}

export function CentreAnnouncementList({ code, items }: { code: string; items: CentreAnnouncement[] }) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<ActionState>(IDLE)
  const [, startTransition] = useTransition()

  function toggle(item: CentreAnnouncement) {
    setBusyId(item.id)
    startTransition(async () => {
      setMessage(await setAnnouncementDismissedAction(code, item.id, !item.dismissed))
      setBusyId(null)
    })
  }

  if (items.length === 0) return <p className="text-sm text-muted-foreground">No announcements from your project admin.</p>

  return (
    <div className="space-y-3">
      {message.status === "error" ? <FormMessage state={message} /> : null}
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id} className={cn("rounded-lg border bg-card p-4", item.dismissed && "text-muted-foreground")}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {item.title}
                  {!item.dismissed ? <span className="ml-2 rounded-md border px-1.5 py-0.5 text-xs font-normal">New</span> : null}
                </p>
                <p className="text-xs text-muted-foreground">{formatDateTimeIso(item.createdAt)}</p>
              </div>
              <Button type="button" size="sm" variant="outline" disabled={busyId === item.id} onClick={() => toggle(item)}>
                {item.dismissed ? "Mark unread" : "Dismiss"}
              </Button>
            </div>
            <p className="mt-2 text-sm whitespace-pre-wrap">{item.body}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ProfileForm({ code, fullName, phone }: { code: string; fullName: string; phone: string | null }) {
  const [state, action, pending] = useActionState(updateProfileAction.bind(null, code), IDLE)
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="profile-name" label="Full name">
          <input id="profile-name" name="fullName" required maxLength={120} defaultValue={fullName} className={inputClass} />
        </Field>
        <Field id="profile-phone" label="Phone" hint="(optional)">
          <input id="profile-phone" name="phone" type="tel" maxLength={30} defaultValue={phone ?? ""} className={inputClass} />
        </Field>
      </div>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save profile"}
      </Button>
    </form>
  )
}

export function ChangePasswordForm({ code }: { code: string }) {
  const [state, action, pending] = useActionState(changePasswordAction.bind(null, code), IDLE)
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="new-password" label="New password" hint="(at least 10 characters)">
          <input id="new-password" name="password" type="password" required minLength={10} maxLength={72} autoComplete="new-password" className={inputClass} />
        </Field>
        <Field id="confirm-password" label="Confirm password">
          <input id="confirm-password" name="confirmPassword" type="password" required autoComplete="new-password" className={inputClass} />
        </Field>
      </div>
      <FormMessage state={state} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Changing..." : "Change password"}
      </Button>
    </form>
  )
}
