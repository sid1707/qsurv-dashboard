"use client"

import { useActionState, useState } from "react"
import { changeKitAction, updateDetailsAction } from "@/app/(app)/p/[code]/admin/actions"
import { Field, FormMessage, inputClass, textareaClass } from "@/components/project-admin/form"
import { Button } from "@/components/ui/button"
import { DmyDateInput } from "@/components/ui/dmy-date-input"
import { FREQUENCIES } from "@/lib/onboarding/schema"
import { IDLE } from "@/lib/project-admin/result"

export type ProjectDetailsValues = {
  title: string
  objective: string | null
  fundingAgency: string | null
  ethicsReference: string | null
  startDate: string | null
  endDate: string | null
  frequency: string
}

export function ProjectDetailsForm({ code, values }: { code: string; values: ProjectDetailsValues }) {
  const [state, action, pending] = useActionState(updateDetailsAction.bind(null, code), IDLE)

  return (
    <form action={action} className="space-y-3">
      <Field id="project-title" label="Project title">
        <input id="project-title" name="title" required maxLength={200} defaultValue={values.title} className={inputClass} />
      </Field>
      <Field id="project-objective" label="Objective" hint="(optional)">
        <textarea
          id="project-objective"
          name="objective"
          rows={4}
          maxLength={4000}
          defaultValue={values.objective ?? ""}
          className={textareaClass}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="project-funding" label="Funding agency" hint="(optional)">
          <input
            id="project-funding"
            name="fundingAgency"
            maxLength={200}
            defaultValue={values.fundingAgency ?? ""}
            className={inputClass}
          />
        </Field>
        <Field id="project-ethics" label="Ethics approval reference" hint="(optional)">
          <input
            id="project-ethics"
            name="ethicsReference"
            maxLength={200}
            defaultValue={values.ethicsReference ?? ""}
            className={inputClass}
          />
        </Field>
        <Field id="project-start" label="Start date" hint="(optional)">
          <DmyDateInput id="project-start" name="startDate" defaultYmd={values.startDate ?? undefined} />
        </Field>
        <Field id="project-end" label="End date" hint="(optional)">
          <DmyDateInput id="project-end" name="endDate" defaultYmd={values.endDate ?? undefined} />
        </Field>
        <Field id="project-frequency" label="Sampling frequency">
          <select id="project-frequency" name="frequency" defaultValue={values.frequency} className={inputClass}>
            {FREQUENCIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save details"}
      </Button>
    </form>
  )
}

export function ChangeKitForm({
  code,
  currentKitId,
  kits,
}: {
  code: string
  currentKitId: string
  kits: { id: string; label: string }[]
}) {
  const [state, action, pending] = useActionState(changeKitAction.bind(null, code), IDLE)
  const [kitId, setKitId] = useState(currentKitId)
  const changed = kitId !== currentKitId

  return (
    <form action={action} className="space-y-3">
      <Field id="project-kit" label="Change kit">
        <select
          id="project-kit"
          name="kitId"
          value={kitId}
          onChange={(e) => setKitId(e.target.value)}
          className={inputClass}
        >
          {kits.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
              {k.id === currentKitId ? " (current)" : ""}
            </option>
          ))}
        </select>
      </Field>
      {changed ? (
        <p className="text-sm text-muted-foreground">
          The plate layout and the quality-check and compilation rules will be reset to the new kit&apos;s defaults.
        </p>
      ) : null}
      <FormMessage state={state} />
      <Button type="submit" variant="outline" disabled={pending || !changed}>
        {pending ? "Changing..." : "Change kit"}
      </Button>
    </form>
  )
}
