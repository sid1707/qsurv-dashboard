"use client"

import { useActionState, useState, useTransition } from "react"
import { changeRoleAction, inviteUserAction, removeUserAction } from "@/app/(app)/p/[code]/admin/actions"
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
import { roleLabel, type MembershipRole } from "@/lib/auth/access"
import { CENTRE_ID_HINT } from "@/lib/centres/file-name"
import { formatDateTimeIso } from "@/lib/format"
import { IDLE, type ActionState } from "@/lib/project-admin/result"
import type { ProjectMember } from "@/lib/project-admin/users"
import type { Seats } from "@/lib/project-admin/user-limits"

export type CentreOption = { id: string; name: string; code: string | null; fileCode: string }

/** Role select plus, for centre users, a centre select. */
function RoleFields({
  idPrefix,
  centres,
  initialRole = "centre_user",
  initialCentreId = "",
  askCentreId = false,
}: {
  idPrefix: string
  centres: CentreOption[]
  initialRole?: MembershipRole
  initialCentreId?: string
  /** On the invite form: give the centre its ID if it has none yet. */
  askCentreId?: boolean
}) {
  const [role, setRole] = useState<MembershipRole>(initialRole)
  const [centreChoice, setCentreChoice] = useState(initialCentreId)
  const [centreId, setCentreId] = useState("")
  const chosen = centres.find((c) => c.id === centreChoice)
  return (
    <>
      <Field id={`${idPrefix}-role`} label="Role">
        <select
          id={`${idPrefix}-role`}
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value as MembershipRole)}
          className={inputClass}
        >
          <option value="centre_user">Centre user</option>
          <option value="project_admin">Project admin</option>
        </select>
      </Field>
      {role === "centre_user" ? (
        <Field id={`${idPrefix}-centre`} label="Centre">
          <select
            id={`${idPrefix}-centre`}
            name="centreId"
            required
            value={centreChoice}
            onChange={(e) => setCentreChoice(e.target.value)}
            className={inputClass}
          >
            <option value="" disabled>
              Choose a centre
            </option>
            {centres.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code ? `${c.code} · ${c.name}` : c.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {askCentreId && role === "centre_user" && chosen && !chosen.code ? (
        <Field id={`${idPrefix}-centre-code`} label="Centre ID for this centre" hint="(once per centre)">
          <input
            id={`${idPrefix}-centre-code`}
            name="centreCode"
            required
            maxLength={20}
            pattern="[A-Za-z0-9-]{1,20}"
            title={CENTRE_ID_HINT}
            value={centreId}
            onChange={(e) => setCentreId(e.target.value.toUpperCase())}
            aria-describedby={`${idPrefix}-centre-code-hint`}
            className={`${inputClass} font-mono uppercase`}
          />
          <p id={`${idPrefix}-centre-code-hint`} className="text-xs text-muted-foreground">
            The centre&apos;s files will be named{" "}
            <span className="font-mono">
              {centreId || "C01"}_{chosen.fileCode}_DDMMYY.csv
            </span>
            . {CENTRE_ID_HINT}
          </p>
        </Field>
      ) : null}
    </>
  )
}

export function InviteUserForm({ code, centres, seats }: { code: string; centres: CentreOption[]; seats: Seats }) {
  const [state, action, pending] = useActionState(inviteUserAction.bind(null, code), IDLE)
  const [formKey, setFormKey] = useState(0)
  const [lastState, setLastState] = useState(state)
  if (state !== lastState) {
    setLastState(state)
    if (state.status === "success") setFormKey((k) => k + 1)
  }

  if (seats.full) {
    return (
      <div className="space-y-2">
        <FormMessage state={state} />
        <p className="text-sm">
          This project has reached its limit of {seats.limit} users. Remove a user before inviting someone new, or ask
          the QSurv team to raise the limit.
        </p>
      </div>
    )
  }

  return (
    <form key={formKey} action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="invite-email" label="Email">
          <input id="invite-email" name="email" type="email" required autoComplete="off" className={inputClass} />
        </Field>
        <Field id="invite-name" label="Full name">
          <input id="invite-name" name="fullName" required maxLength={120} autoComplete="off" className={inputClass} />
        </Field>
        <RoleFields idPrefix="invite" centres={centres} askCentreId />
      </div>
      <p className="text-xs text-muted-foreground">
        New users get an email link to set their password. People who already have a QSurv account are added straight
        away.
      </p>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Sending..." : "Send invite"}
      </Button>
    </form>
  )
}

function ChangeRoleForm({
  code,
  member,
  centres,
  onDone,
}: {
  code: string
  member: ProjectMember
  centres: CentreOption[]
  onDone: () => void
}) {
  const [state, action, pending] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await changeRoleAction(code, prev, formData)
    if (result.status === "success") onDone()
    return result
  }, IDLE)

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="membershipId" value={member.membershipId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <RoleFields
          idPrefix={`member-${member.membershipId}`}
          centres={centres}
          initialRole={member.role}
          initialCentreId={member.centreId ?? ""}
        />
      </div>
      <FormMessage state={state} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving..." : "Save role"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function RemoveMemberButton({
  member,
  isSelf,
  onRemove,
}: {
  member: ProjectMember
  isSelf: boolean
  onRemove: () => void
}) {
  const name = member.fullName || member.email
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button type="button" size="sm" variant="destructive" />}>Remove</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {isSelf
              ? "You will lose access to this project straight away."
              : "They will lose access to this project. Their account and any data they uploaded stay."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onRemove}>
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function MemberList({
  code,
  members,
  centres,
  currentUserId,
}: {
  code: string
  members: ProjectMember[]
  centres: CentreOption[]
  currentUserId: string
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [message, setMessage] = useState<ActionState>(IDLE)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function remove(member: ProjectMember) {
    setBusyId(member.membershipId)
    startTransition(async () => {
      setMessage(await removeUserAction(code, member.membershipId))
      setBusyId(null)
    })
  }

  return (
    <div className="space-y-3">
      <FormMessage state={message} />
      <ul className="divide-y">
        {members.map((member) => {
          const isSelf = member.userId === currentUserId
          return (
            <li key={member.membershipId} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {member.fullName || member.email}
                    {isSelf ? <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span> : null}
                    {member.invitePending ? (
                      <span className="ml-2 rounded-md border px-1.5 py-0.5 text-xs font-normal">Invite pending</span>
                    ) : null}
                  </p>
                  <p className="text-sm break-all text-muted-foreground">{member.email}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {roleLabel(member.role)}
                    {member.centreName ? ` · ${member.centreName}` : ""}
                    {member.lastSignInAt ? ` · Last sign-in ${formatDateTimeIso(member.lastSignInAt)}` : ""}
                  </p>
                </div>
                {editing !== member.membershipId ? (
                  <div className="flex shrink-0 gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditing(member.membershipId)}>
                      Change role
                    </Button>
                    {busyId === member.membershipId ? (
                      <Button type="button" size="sm" variant="destructive" disabled>
                        Removing...
                      </Button>
                    ) : (
                      <RemoveMemberButton member={member} isSelf={isSelf} onRemove={() => remove(member)} />
                    )}
                  </div>
                ) : null}
              </div>
              {editing === member.membershipId ? (
                <div className="mt-3">
                  <ChangeRoleForm code={code} member={member} centres={centres} onDone={() => setEditing(null)} />
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
