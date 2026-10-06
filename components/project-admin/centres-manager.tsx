"use client"

import { useActionState, useState, useTransition } from "react"
import { createCentreAction, setCentreActiveAction, updateCentreAction } from "@/app/(app)/p/[code]/admin/actions"
import { Field, FormMessage, inputClass } from "@/components/project-admin/form"
import { Button } from "@/components/ui/button"
import { CENTRE_ID_HINT, centreFileCode } from "@/lib/centres/file-name"
import type { CentreRow } from "@/lib/project-admin/centres"
import { IDLE, type ActionState } from "@/lib/project-admin/result"
import { cn } from "@/lib/utils"

function CentreFields({ centre, idPrefix }: { centre?: CentreRow; idPrefix: string }) {
  const [name, setName] = useState(centre?.name ?? "")
  const [city, setCity] = useState(centre?.city ?? "")
  const [centreId, setCentreId] = useState(centre?.code ?? "")
  // Once the centre has uploaded, the database keeps its file code; show the stored one.
  const fileCode = centre?.file_code && (centre.name !== name || centre.city !== city) ? centreFileCode(name, city) : centre?.file_code ?? centreFileCode(name, city)
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field id={`${idPrefix}-name`} label="Name">
        <input
          id={`${idPrefix}-name`}
          name="name"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field id={`${idPrefix}-email`} label="Contact email" hint="(optional)">
        <input
          id={`${idPrefix}-email`}
          name="contactEmail"
          type="email"
          maxLength={254}
          defaultValue={centre?.contact_email ?? ""}
          className={inputClass}
        />
      </Field>
      <Field id={`${idPrefix}-city`} label="City">
        <input
          id={`${idPrefix}-city`}
          name="city"
          required
          maxLength={80}
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field id={`${idPrefix}-code`} label="Centre ID" hint="(can also be given when adding its users)">
        <input
          id={`${idPrefix}-code`}
          name="code"
          maxLength={20}
          pattern="[A-Za-z0-9-]{1,20}"
          title={CENTRE_ID_HINT}
          value={centreId}
          onChange={(e) => setCentreId(e.target.value.toUpperCase())}
          className={cn(inputClass, "font-mono uppercase")}
        />
      </Field>
      <div className="space-y-1.5 text-sm">
        <p className="font-medium">File names</p>
        <p className="font-mono text-xs break-all text-muted-foreground">
          {centreId || "<Centre ID>"}_{fileCode || "Name_City"}_DDMMYY.csv
        </p>
      </div>
      <Field id={`${idPrefix}-state`} label="State" hint="(optional)">
        <input id={`${idPrefix}-state`} name="state" maxLength={80} defaultValue={centre?.state ?? ""} className={inputClass} />
      </Field>
    </div>
  )
}

export function AddCentreForm({ code }: { code: string }) {
  const [state, action, pending] = useActionState(createCentreAction.bind(null, code), IDLE)
  // A new key after each success clears the form.
  const [formKey, setFormKey] = useState(0)
  const [lastState, setLastState] = useState(state)
  if (state !== lastState) {
    setLastState(state)
    if (state.status === "success") setFormKey((k) => k + 1)
  }

  return (
    <form key={formKey} action={action} className="space-y-3">
      <CentreFields idPrefix="new-centre" />
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Adding..." : "Add centre"}
      </Button>
    </form>
  )
}

function EditCentreForm({ code, centre, onDone }: { code: string; centre: CentreRow; onDone: () => void }) {
  const [state, action, pending] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await updateCentreAction(code, prev, formData)
    if (result.status === "success") onDone()
    return result
  }, IDLE)

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="centreId" value={centre.id} />
      <CentreFields centre={centre} idPrefix={`centre-${centre.id}`} />
      <FormMessage state={state} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving..." : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function CentreList({ code, centres }: { code: string; centres: CentreRow[] }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [message, setMessage] = useState<ActionState>(IDLE)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function toggleActive(centre: CentreRow) {
    setBusyId(centre.id)
    startTransition(async () => {
      setMessage(await setCentreActiveAction(code, centre.id, !centre.active))
      setBusyId(null)
    })
  }

  if (centres.length === 0) {
    return <p className="text-sm text-muted-foreground">No centres yet. Add the first one above.</p>
  }

  return (
    <div className="space-y-3">
      <FormMessage state={message} />
      <ul className="divide-y">
        {centres.map((centre) => (
          <li key={centre.id} className="py-3 first:pt-0 last:pb-0">
            {editing === centre.id ? (
              <EditCentreForm code={code} centre={centre} onDone={() => setEditing(null)} />
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className={cn("min-w-0", !centre.active && "text-muted-foreground")}>
                  <p className="font-medium">
                    {centre.name}
                    {!centre.active ? (
                      <span className="ml-2 rounded-md border px-1.5 py-0.5 text-xs font-normal">Deactivated</span>
                    ) : null}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {centre.code ?? "No centre ID"} · {centre.file_code}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {[centre.city, centre.state].filter(Boolean).join(", ") || "No location"}
                    {centre.contact_email ? ` · ${centre.contact_email}` : ""}
                    {` · ${centre.users} user${centre.users === 1 ? "" : "s"}`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditing(centre.id)}>
                    Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={centre.active ? "destructive" : "outline"}
                    disabled={busyId === centre.id}
                    onClick={() => toggleActive(centre)}
                  >
                    {busyId === centre.id ? "Saving..." : centre.active ? "Deactivate" : "Reactivate"}
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
