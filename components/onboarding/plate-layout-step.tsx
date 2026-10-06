"use client"

import { useState } from "react"
import { RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ROLE_LABEL, ROLE_SHORT, tubeColour } from "@/components/plate/kit-panel"
import { LayoutPreview } from "@/components/plate/layout-preview"
import { PlateGrid } from "@/components/plate/plate-grid"
import type { KitSummary } from "@/lib/kits/public"
import {
  MAX_SAMPLES_PER_PLATE,
  MULTI_SAMPLE_MODES,
  SAMPLE_IDENTIFIER_COLUMNS,
  WELL_ROLES,
  countRolesByTube,
  layoutCapacity,
  paintWell,
  presetLayout,
  samplesPerPlate,
  totalWellsPerTube,
  type LayoutCounts,
  type MultiSampleMode,
  type PlateLayout,
  type WellRole,
} from "@/lib/plate/layout"
import { cn } from "@/lib/utils"

type Brush = { tube: string; role: WellRole } | { clear: true }

const COUNT_FIELDS = [
  { key: "unknownReplicates", label: "Unknown replicates", min: 1 },
  { key: "pc", label: "Positive controls", min: 0 },
  { key: "nc", label: "Negative controls", min: 0 },
] as const

const inputClass =
  "h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive"

export function PlateLayoutStep({
  kit,
  layout,
  error,
  onChange,
}: {
  kit: KitSummary
  layout: PlateLayout
  error?: string
  onChange: (layout: PlateLayout) => void
}) {
  const capacity = layoutCapacity(kit)
  const [counts, setCounts] = useState<Record<string, string>>(() => ({
    unknownReplicates: String(layout.counts.unknownReplicates),
    pc: String(layout.counts.pc),
    nc: String(layout.counts.nc),
  }))
  const [samples, setSamples] = useState(samplesPerPlate(layout.counts))
  const [sampleMode, setSampleMode] = useState<MultiSampleMode>(layout.multiSample?.mode ?? "dates")
  const [mode, setMode] = useState<"edit" | "preview">("edit")
  const [brush, setBrush] = useState<Brush>({ tube: kit.tubes[0]?.name ?? "", role: "unknown" })

  const toCounts = (c: Record<string, string>, n: number): LayoutCounts => ({
    unknownReplicates: Number(c.unknownReplicates),
    pc: Number(c.pc),
    nc: Number(c.nc),
    samples: n,
  })
  const fits = (c: LayoutCounts) =>
    COUNT_FIELDS.every((f) => Number.isInteger(c[f.key]) && c[f.key] >= f.min) && totalWellsPerTube(c) <= capacity
  const parsedCounts = toCounts(counts, samples)
  const countsValid = fits(parsedCounts)
  // Most samples whose replicates and the controls still fit in one tube's wells.
  const maxSamples = Math.max(
    1,
    Math.min(
      MAX_SAMPLES_PER_PLATE,
      Math.floor((capacity - parsedCounts.pc - parsedCounts.nc) / Math.max(1, parsedCounts.unknownReplicates))
    )
  )

  /** Any change to the counts or samples resets the plate to the preset. */
  function apply(nextCounts: Record<string, string>, nextSamples: number, nextMode: MultiSampleMode) {
    setCounts(nextCounts)
    setSamples(nextSamples)
    setSampleMode(nextMode)
    const parsed = toCounts(nextCounts, nextSamples)
    if (fits(parsed)) onChange(presetLayout(kit, parsed, nextMode))
  }

  function updateCount(key: string, value: string) {
    apply({ ...counts, [key]: value }, samples, sampleMode)
  }

  const tubeIndex = new Map(kit.tubes.map((t, i) => [t.name, i]))
  const roleCounts = countRolesByTube(layout)
  const tubesAxis = kit.orientation === "tubes_in_rows" ? "row" : "column"

  return (
    <div className="space-y-6 md:col-span-2">
      <fieldset>
        <legend className="text-sm font-medium">Wells per tube</legend>
        <p className="mt-1 text-xs text-muted-foreground">
          Each sample is run in every tube of the kit. The preset puts one tube per plate {tubesAxis}, with up to{" "}
          {capacity} wells per tube. Changing these numbers resets the layout below to the preset.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {COUNT_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <label htmlFor={`count-${f.key}`} className="text-sm">
                {f.label}
              </label>
              <input
                id={`count-${f.key}`}
                type="number"
                inputMode="numeric"
                min={f.min}
                max={capacity}
                value={counts[f.key]}
                aria-invalid={!countsValid || undefined}
                onChange={(e) => updateCount(f.key, e.target.value)}
                className={inputClass}
              />
            </div>
          ))}
        </div>
        {!countsValid ? (
          <p className="mt-2 text-xs text-destructive">
            Use whole numbers (at least 1 unknown replicate) adding up to {capacity} wells or fewer per tube
            {samples > 1 ? `, counting the replicates of all ${samples} samples` : ""}.
          </p>
        ) : null}
      </fieldset>

      <fieldset className="space-y-3 rounded-md border p-4">
        <legend className="px-1 text-sm font-medium">Samples per plate</legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={samples > 1}
            disabled={samples === 1 && maxSamples < 2}
            onChange={(e) => apply(counts, e.target.checked ? 2 : 1, sampleMode)}
          />
          <span>
            Run more than one sample on one 96-well plate
            <span className="block text-xs text-muted-foreground">
              {maxSamples < 2 && samples === 1
                ? `A second set of ${parsedCounts.unknownReplicates} replicates does not fit in ${capacity} wells per tube with these controls.`
                : "Each sample gets its own set of unknown replicates in every tube, sharing the plate's controls. The samples can sit in any of the unknown wells."}
            </span>
          </span>
        </label>

        {samples > 1 ? (
          <div className="space-y-3 pl-6">
            <label className="flex items-center gap-2 text-sm">
              Samples on each plate
              <select
                value={samples}
                onChange={(e) => apply(counts, Number(e.target.value), sampleMode)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                {Array.from({ length: Math.max(2, maxSamples) - 1 }, (_, i) => i + 2).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <div role="radiogroup" aria-label="What the samples on a plate are" className="grid gap-2 sm:grid-cols-2">
              {MULTI_SAMPLE_MODES.map((m) => (
                <label
                  key={m.value}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm",
                    sampleMode === m.value && "border-primary"
                  )}
                >
                  <input
                    type="radio"
                    name="multiSampleMode"
                    className="mt-0.5"
                    checked={sampleMode === m.value}
                    onChange={() => apply(counts, samples, m.value)}
                  />
                  <span>
                    {m.label}
                    <span className="block text-xs text-muted-foreground">{m.description}</span>
                  </span>
                </label>
              ))}
            </div>

            <p role="note" className="rounded-md border bg-muted/40 p-3 text-xs">
              Runs are split into one file per sample by each sample&apos;s identifier, not by well, before they are
              checked and compiled, as in the AMR portal. Centres must put each sample&apos;s identifier in the{" "}
              {SAMPLE_IDENTIFIER_COLUMNS.map((c, i) => (
                <span key={c}>
                  {i > 0 ? (i === SAMPLE_IDENTIFIER_COLUMNS.length - 1 ? " or " : ", ") : ""}
                  <strong>{c}</strong>
                </span>
              ))}{" "}
              column of the exported CSV
              {sampleMode === "dates"
                ? ": the sample's collection date as DDMMYY or DDMMYYYY (e.g. 01102026, or WW_01102026)."
                : ": a site label that is the same in all of that sample's wells (e.g. ETP, STP)."}
            </p>
          </div>
        ) : null}
      </fieldset>

      <div>
        <div role="group" aria-label="Plate layout view" className="inline-flex rounded-md border p-0.5">
          {(
            [
              ["edit", "Edit layout"],
              ["preview", "Preview with targets"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                "rounded px-3 py-1.5 text-sm",
                mode === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "edit" ? (
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Pick a tube and a role, then click wells to place them (drag to paint several). Use Clear to empty a
                well.
              </p>
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-2 text-sm">
                  Tube
                  <select
                    value={"tube" in brush ? brush.tube : ""}
                    onChange={(e) =>
                      setBrush({ tube: e.target.value, role: "role" in brush ? brush.role : "unknown" })
                    }
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                  >
                    {"clear" in brush ? <option value="">—</option> : null}
                    {kit.tubes.map((t, i) => (
                      <option key={t.name} value={t.name}>
                        {i + 1}. {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div role="radiogroup" aria-label="Well role" className="flex flex-wrap gap-1">
                  {WELL_ROLES.map((r) => {
                    const active = "role" in brush && brush.role === r.value
                    return (
                      <button
                        key={r.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() =>
                          setBrush({ tube: "tube" in brush ? brush.tube : kit.tubes[0]?.name ?? "", role: r.value })
                        }
                        className={cn(
                          "h-9 rounded-md border px-3 text-sm",
                          active ? "border-primary bg-primary text-primary-foreground" : "bg-background"
                        )}
                      >
                        {r.label}
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={"clear" in brush}
                    onClick={() => setBrush({ clear: true })}
                    className={cn(
                      "h-9 rounded-md border px-3 text-sm",
                      "clear" in brush ? "border-primary bg-primary text-primary-foreground" : "bg-background"
                    )}
                  >
                    Clear
                  </button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9"
                  disabled={!countsValid}
                  onClick={() => onChange(presetLayout(kit, parsedCounts, sampleMode))}
                >
                  <RotateCcw aria-hidden /> Reset to preset
                </Button>
              </div>
            </div>

            {layout.plates.map((wells, p) => (
              <figure key={p} className="space-y-2">
                {layout.plates.length > 1 ? <figcaption className="text-sm font-medium">Plate {p + 1}</figcaption> : null}
                <PlateGrid
                  label={layout.plates.length > 1 ? `Plate ${p + 1} layout editor` : "Plate layout editor"}
                  onWell={(id) => onChange(paintWell(layout, p, id, "clear" in brush ? null : brush))}
                  well={(id) => {
                    const w = wells[id]
                    if (!w) return { description: `${id}: empty` }
                    const ti = tubeIndex.get(w.tube) ?? -1
                    return {
                      description: `${id}: ${w.tube}, ${ROLE_LABEL[w.role].toLowerCase()}`,
                      className: tubeColour(Math.max(ti, 0)),
                      children: (
                        <>
                          <span className="text-[9px] opacity-80">T{ti + 1}</span>
                          <span className="font-semibold">{ROLE_SHORT[w.role]}</span>
                        </>
                      ),
                    }
                  }}
                />
              </figure>
            ))}

            <TubeTally kit={kit} roleCounts={roleCounts} counts={layout.counts} />
          </div>
        ) : (
          <div className="mt-4">
            <LayoutPreview tubes={kit.tubes} layout={layout} />
          </div>
        )}
      </div>

      {error ? (
        <p id="plateLayout-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {/* Focus target for the step's error. */}
      <span id="plateLayout" tabIndex={-1} className="sr-only">
        Plate layout
      </span>
    </div>
  )
}

/** Per-tube counts against the target, so mistakes are visible while editing. */
function TubeTally({
  kit,
  roleCounts,
  counts,
}: {
  kit: KitSummary
  roleCounts: ReturnType<typeof countRolesByTube>
  counts: LayoutCounts
}) {
  const expected: Record<WellRole, number> = {
    unknown: samplesPerPlate(counts) * counts.unknownReplicates,
    pc: counts.pc,
    nc: counts.nc,
  }
  return (
    <ul className="grid gap-1 text-xs sm:grid-cols-2">
      {kit.tubes.map((tube, i) => {
        const got = roleCounts.get(tube.name) ?? { unknown: 0, pc: 0, nc: 0 }
        const ok = WELL_ROLES.every((r) => got[r.value] === expected[r.value])
        return (
          <li key={tube.name} className="flex items-center gap-2">
            <span className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded border text-[10px]", tubeColour(i))}>
              {i + 1}
            </span>
            <span className="truncate">{tube.name}</span>
            <span className={cn("ml-auto tabular-nums", ok ? "text-muted-foreground" : "font-medium text-destructive")}>
              {WELL_ROLES.map((r) => `${got[r.value]} ${r.short}`).join(" · ")}
              {ok ? "" : " (check)"}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
