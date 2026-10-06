"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash2 } from "lucide-react"
import { saveKitAction } from "@/app/(app)/super-admin/actions"
import { Button } from "@/components/ui/button"
import {
  CONTROL_TYPES,
  EMPTY_TARGET,
  LAYOUT_ORIENTATIONS,
  PLATE_COLUMNS,
  PLATE_ROWS,
  parseList,
  validateKitForm,
  type FieldErrors,
  type KitFormValues,
  type TargetFormRow,
} from "@/lib/kits/schema"
import { cn } from "@/lib/utils"

type Row = TargetFormRow & { key: number }

const inputClass =
  "h-9 w-full rounded-md border bg-background px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive"

// Stable React keys for target rows, which have no id until saved.
let rowKeyCounter = 0
const withKey = (t: TargetFormRow): Row => ({ ...t, key: rowKeyCounter++ })

// Distinguishes targets in the plate preview; repeats after eight targets.
const TARGET_COLOURS = [
  "bg-blue-500",
  "bg-orange-500",
  "bg-emerald-500",
  "bg-fuchsia-500",
  "bg-red-500",
  "bg-cyan-500",
  "bg-yellow-500",
  "bg-violet-500",
]

export function KitEditor({
  title,
  initial,
  projectCount,
}: {
  title: string
  initial: KitFormValues
  projectCount: number
}) {
  const router = useRouter()
  const [kit, setKit] = useState({
    id: initial.id,
    name: initial.name,
    version: initial.version,
    active: initial.active,
    layoutOrientation: initial.layoutOrientation,
  })
  const [rows, setRows] = useState<Row[]>(() => initial.targets.map(withKey))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, startSave] = useTransition()

  function updateRow(index: number, patch: Partial<TargetFormRow>) {
    setRows((current) => current.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  function move(index: number, delta: number) {
    setRows((current) => {
      const next = [...current]
      const [row] = next.splice(index, 1)
      next.splice(index + delta, 0, row)
      return next
    })
    setErrors({})
  }

  function remove(index: number) {
    setRows((current) => current.filter((_, i) => i !== index))
    setErrors({})
  }

  function submit() {
    // Row keys are UI-only; zod drops unknown fields on the client and server.
    const values: KitFormValues = { ...kit, targets: rows }
    const check = validateKitForm(values)
    setErrors(check.errors)
    if (!check.ok) {
      setFormError("Please fix the highlighted fields.")
      const first = Object.keys(check.errors)[0]
      if (first) requestAnimationFrame(() => document.getElementById(first)?.focus())
      return
    }
    setFormError(null)
    startSave(async () => {
      try {
        const result = await saveKitAction(values)
        if (result.ok) {
          router.push("/super-admin/kits?saved=1")
          return
        }
        setFormError(result.message)
        setErrors(result.errors ?? {})
      } catch {
        setFormError("The kit could not be saved. Please try again.")
      }
    })
  }

  const err = (path: string) => errors[path]
  const aria = (path: string) => ({
    id: path,
    "aria-invalid": err(path) ? true : undefined,
    "aria-describedby": err(path) ? `${path}-error` : undefined,
  })

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="space-y-6"
    >
      <div>
        <Link href="/super-admin/kits" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> All kits
        </Link>
        <h2 className="mt-3 text-xl font-semibold">{title}</h2>
        {projectCount > 0 ? (
          <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {projectCount} project{projectCount === 1 ? " uses" : "s use"} this kit. Changes to targets, wells
            and Ct limits apply to their future validation. For a real panel change, consider adding a new
            version instead.
          </p>
        ) : null}
      </div>

      <section className="grid gap-4 rounded-lg border bg-card p-5 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <label htmlFor="name" className="text-sm font-medium">
            Kit name
          </label>
          <input
            {...aria("name")}
            value={kit.name}
            onChange={(e) => setKit({ ...kit, name: e.target.value })}
            className={inputClass}
          />
          <FieldError path="name" message={err("name")} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="version" className="text-sm font-medium">
            Version
          </label>
          <input
            {...aria("version")}
            value={kit.version}
            onChange={(e) => setKit({ ...kit, version: e.target.value })}
            className={inputClass}
          />
          <FieldError path="version" message={err("version")} />
        </div>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={kit.active}
            onChange={(e) => setKit({ ...kit, active: e.target.checked })}
            className="size-4 accent-primary"
          />
          Active (offered on the onboarding form)
        </label>
        <div className="space-y-1.5 sm:col-span-3">
          <label htmlFor="layoutOrientation" className="text-sm font-medium">
            Preset plate layout
          </label>
          <select
            {...aria("layoutOrientation")}
            value={kit.layoutOrientation}
            onChange={(e) => setKit({ ...kit, layoutOrientation: e.target.value })}
            className={inputClass}
          >
            {LAYOUT_ORIENTATIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Starting layout offered on the onboarding form. Each project adjusts its own layout.
          </p>
          <FieldError path="layoutOrientation" message={err("layoutOrientation")} />
        </div>
      </section>

      <section className="rounded-lg border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">Targets and controls</h3>
            <p className="text-xs text-muted-foreground">
              Targets in the same tube are read in one well, so each needs its own fluorophore. Aliases are
              names that may appear in run files, separated by commas. Default wells (A1 to H12) are optional.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setRows([...rows, withKey({ ...EMPTY_TARGET })])}>
            <Plus aria-hidden /> Add target
          </Button>
        </div>
        <FieldError path="targets" message={err("targets")} />

        <div className="mt-4 space-y-3">
          {rows.map((row, i) => {
            const p = (field: string) => `targets.${i}.${field}`
            return (
              <div key={row.key} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <span className={cn("size-3 rounded-full", TARGET_COLOURS[i % TARGET_COLOURS.length])} aria-hidden />
                    {row.targetName || `Target ${i + 1}`}
                  </span>
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Move down"
                      disabled={i === rows.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${row.targetName || `target ${i + 1}`}`} onClick={() => remove(i)}>
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </div>
                <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Cell label="Target name" path={p("targetName")} error={err(p("targetName"))}>
                    <input {...aria(p("targetName"))} value={row.targetName} onChange={(e) => updateRow(i, { targetName: e.target.value })} className={inputClass} />
                  </Cell>
                  <Cell label="Type" path={p("controlType")} error={err(p("controlType"))}>
                    <select {...aria(p("controlType"))} value={row.controlType} onChange={(e) => updateRow(i, { controlType: e.target.value })} className={inputClass}>
                      {CONTROL_TYPES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </Cell>
                  <Cell label="Fluorophore" path={p("fluorophore")} error={err(p("fluorophore"))}>
                    <input {...aria(p("fluorophore"))} value={row.fluorophore} placeholder="FAM" onChange={(e) => updateRow(i, { fluorophore: e.target.value })} className={inputClass} />
                  </Cell>
                  <Cell label="Tube" path={p("tubeName")} error={err(p("tubeName"))}>
                    <input {...aria(p("tubeName"))} value={row.tubeName} placeholder="NVK" onChange={(e) => updateRow(i, { tubeName: e.target.value })} className={inputClass} />
                  </Cell>
                  <Cell label="Tube order" path={p("tubeOrder")} error={err(p("tubeOrder"))}>
                    <input {...aria(p("tubeOrder"))} value={row.tubeOrder} inputMode="numeric" onChange={(e) => updateRow(i, { tubeOrder: e.target.value })} className={inputClass} />
                  </Cell>
                  <Cell label="Channel" path={p("channel")} error={err(p("channel"))}>
                    <input {...aria(p("channel"))} value={row.channel} placeholder="Green" onChange={(e) => updateRow(i, { channel: e.target.value })} className={inputClass} />
                  </Cell>
                  <Cell label="Default wells (optional)" path={p("wells")} error={err(p("wells"))} wide>
                    <input
                      {...aria(p("wells"))}
                      value={row.wells}
                      placeholder="A1, B1, C1"
                      spellCheck={false}
                      onChange={(e) => updateRow(i, { wells: e.target.value })}
                      className={cn(inputClass, "font-mono")}
                    />
                  </Cell>
                  <Cell label="Aliases" path={p("aliases")} error={err(p("aliases"))} wide>
                    <input {...aria(p("aliases"))} value={row.aliases} onChange={(e) => updateRow(i, { aliases: e.target.value })} className={inputClass} />
                  </Cell>
                  <Cell label="Min Ct" path={p("ctMin")} error={err(p("ctMin"))}>
                    <input {...aria(p("ctMin"))} value={row.ctMin} inputMode="decimal" onChange={(e) => updateRow(i, { ctMin: e.target.value })} className={inputClass} />
                  </Cell>
                  <Cell label="Max Ct" path={p("ctMax")} error={err(p("ctMax"))}>
                    <input {...aria(p("ctMax"))} value={row.ctMax} inputMode="decimal" onChange={(e) => updateRow(i, { ctMax: e.target.value })} className={inputClass} />
                  </Cell>
                  <Cell label="Std curve slope" path={p("stdSlope")} error={err(p("stdSlope"))}>
                    <input {...aria(p("stdSlope"))} value={row.stdSlope} inputMode="decimal" placeholder="-3.32" onChange={(e) => updateRow(i, { stdSlope: e.target.value })} className={inputClass} />
                  </Cell>
                  <Cell label="Std curve intercept" path={p("stdIntercept")} error={err(p("stdIntercept"))}>
                    <input {...aria(p("stdIntercept"))} value={row.stdIntercept} inputMode="decimal" placeholder="40.1" onChange={(e) => updateRow(i, { stdIntercept: e.target.value })} className={inputClass} />
                  </Cell>
                  <Cell label="PC copies/mL" path={p("pcCopies")} error={err(p("pcCopies"))}>
                    <input {...aria(p("pcCopies"))} value={row.pcCopies} inputMode="decimal" placeholder="2e6" onChange={(e) => updateRow(i, { pcCopies: e.target.value })} className={inputClass} />
                  </Cell>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {rows.some((r) => r.wells.trim()) ? <PlatePreview rows={rows} /> : null}

      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}
      <div className="flex justify-end gap-3">
        <Link href="/super-admin/kits" className="inline-flex h-8 items-center px-3 text-sm text-muted-foreground hover:text-foreground">
          Cancel
        </Link>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save kit"}
        </Button>
      </div>
    </form>
  )
}

function Cell({
  label,
  path,
  error,
  wide,
  children,
}: {
  label: string
  path: string
  error?: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={cn("space-y-1", wide && "sm:col-span-2")}>
      <label htmlFor={path} className="text-xs text-muted-foreground">
        {label}
      </label>
      {children}
      <FieldError path={path} message={error} />
    </div>
  )
}

function FieldError({ path, message }: { path: string; message?: string }) {
  if (!message) return null
  return (
    <p id={`${path}-error`} className="text-xs text-destructive">
      {message}
    </p>
  )
}

function PlatePreview({ rows }: { rows: Row[] }) {
  const byWell = new Map<string, number[]>()
  rows.forEach((row, i) => {
    for (const well of parseList(row.wells, { upper: true })) {
      byWell.set(well, [...(byWell.get(well) ?? []), i])
    }
  })

  return (
    <section className="rounded-lg border bg-card p-5">
      <h3 className="font-semibold">Default wells preview</h3>
      <p className="text-xs text-muted-foreground">Each dot is a target read in that well.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="border-separate border-spacing-1 text-xs" aria-label="96-well plate layout">
          <thead>
            <tr>
              <th />
              {PLATE_COLUMNS.map((c) => (
                <th key={c} scope="col" className="w-9 font-normal text-muted-foreground">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PLATE_ROWS.map((r) => (
              <tr key={r}>
                <th scope="row" className="pr-1 font-normal text-muted-foreground">
                  {r}
                </th>
                {PLATE_COLUMNS.map((c) => {
                  const well = `${r}${c}`
                  const targets = byWell.get(well) ?? []
                  const names = targets.map((i) => rows[i].targetName || `Target ${i + 1}`).join(", ")
                  return (
                    <td
                      key={well}
                      title={names ? `${well}: ${names}` : well}
                      className={cn(
                        "size-9 rounded-full border p-1 align-middle",
                        targets.length > 0 ? "bg-muted/60" : "bg-background"
                      )}
                    >
                      <span className="sr-only">{names ? `${well}: ${names}` : `${well}: empty`}</span>
                      <span className="flex flex-wrap items-center justify-center gap-0.5" aria-hidden>
                        {targets.slice(0, 4).map((i) => (
                          <span key={i} className={cn("size-1.5 rounded-full", TARGET_COLOURS[i % TARGET_COLOURS.length])} />
                        ))}
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
