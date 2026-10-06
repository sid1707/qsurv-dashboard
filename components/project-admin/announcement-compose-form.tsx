"use client"

// Adapted from vrdl-next-platform components/admin/announcement-compose-form.tsx,
// scoped to one project. In-app link buttons are left out until the centre
// workspace has pages for them to point at.

import { useActionState, useState } from "react"
import { useFormStatus } from "react-dom"
import { createAnnouncementAction, type AnnouncementActionState } from "@/app/(app)/p/[code]/admin/actions"
import { FormMessage, inputClass, textareaClass } from "@/components/project-admin/form"
import { Button } from "@/components/ui/button"
import { ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_TITLE_MAX, type AnnouncementAudience } from "@/lib/announcements/schema"
import { IDLE } from "@/lib/project-admin/result"

type CentreOption = { id: string; name: string }

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Publishing..." : "Publish announcement"}
    </Button>
  )
}

function ComposeFields({ action, centres }: { action: (formData: FormData) => void; centres: CentreOption[] }) {
  const [audience, setAudience] = useState<AnnouncementAudience>("all_centres")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  function toggleCentre(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <form action={action} className="space-y-4">
      {audience === "selected_centres"
        ? Array.from(selectedIds).map((id) => <input key={id} type="hidden" name="centreIds" value={id} />)
        : null}

      <div className="space-y-1">
        <label htmlFor="announcement-title" className="text-sm font-medium">
          Title
        </label>
        <input
          id="announcement-title"
          name="title"
          required
          maxLength={ANNOUNCEMENT_TITLE_MAX}
          className={inputClass}
          placeholder="Upload this month's runs by the 10th"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="announcement-body" className="text-sm font-medium">
          Message
        </label>
        <textarea
          id="announcement-body"
          name="body"
          required
          maxLength={ANNOUNCEMENT_BODY_MAX}
          rows={5}
          className={`min-h-28 ${textareaClass}`}
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Audience</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="audience"
            value="all_centres"
            checked={audience === "all_centres"}
            onChange={() => setAudience("all_centres")}
          />
          All centres
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="audience"
            value="selected_centres"
            checked={audience === "selected_centres"}
            onChange={() => setAudience("selected_centres")}
          />
          Selected centres
        </label>
      </fieldset>

      {audience === "selected_centres" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Centres</p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => setSelectedIds(new Set(centres.map((c) => c.id)))}
              >
                Select all
              </Button>
              <Button type="button" variant="outline" size="xs" onClick={() => setSelectedIds(new Set())}>
                Clear
              </Button>
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto rounded-md border p-2">
            {centres.length === 0 ? (
              <p className="px-1 py-2 text-sm text-muted-foreground">No active centres found.</p>
            ) : (
              <ul className="space-y-1">
                {centres.map((centre) => (
                  <li key={centre.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted/50">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(centre.id)}
                        onChange={() => toggleCentre(centre.id)}
                      />
                      <span>{centre.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{selectedIds.size} selected</p>
        </div>
      ) : null}

      <SubmitButton />
    </form>
  )
}

export function AnnouncementComposeForm({ code, centres }: { code: string; centres: CentreOption[] }) {
  const [state, action] = useActionState<AnnouncementActionState, FormData>(
    createAnnouncementAction.bind(null, code),
    IDLE
  )

  return (
    <div className="space-y-4">
      <FormMessage state={state} />
      {/* A new key after each publish clears the form. */}
      <ComposeFields key={state.announcementId ?? "new"} action={action} centres={centres} />
    </div>
  )
}
