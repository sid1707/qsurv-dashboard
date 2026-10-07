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
  SAMPLE_IDENTIFIER_COLUMNS,
  WELL_ROLES,
  countRolesByTube,
  expandLayout,
  layoutCapacity,
  paintWell,
  presetLayout,
  samplesPerPlate,
  totalWellsPerTube,
  type LayoutCounts,
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
  const [mode, setMode] = useState<"edit" | "preview" | "multi">("edit")
  const [brush, setBrush] = useState<Brush>({ tube: kit.tubes[0]?.name ?? "", role: "unknown" })

  const toCounts = (c: Record<string, string>): LayoutCounts => ({
    unknownReplicates: Number(c.unknownReplicates),
    pc: Number(c.pc),
    nc: Number(c.nc),
  })
  const fits = (c: LayoutCounts) =>
    COUNT_FIELDS.every((f) => Number.isInteger(c[f.key]) && c[f.key] >= f.min) && totalWellsPerTube(c) <= capacity
  const parsedCounts = toCounts(counts)
  const countsValid = fits(parsedCounts)

  /** Any change to the counts resets the plate to the preset. */
  function updateCount(key: string, value: string) {
    const next = { ...counts, [key]: value }
    setCounts(next)
    const parsed = toCounts(next)
    if (fits(parsed)) onChange(presetLayout(kit, parsed))
  }

  // How the plate looks when a centre runs two samples on it (chosen on each upload).
  const twoSamples = expandLayout(layout, { samples: 2, mode: "dates" })

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
            Use whole numbers (at least 1 unknown replicate) adding up to {capacity} wells or fewer per tube.
          </p>
        ) : null}
        <p className="mt-2 text-xs text-muted-foreground">
          This is the layout for one sample per plate. Centres can run up to {MAX_SAMPLES_PER_PLATE} samples (from
          multiple dates or multiple sites) on one plate by choosing the plate composition when they upload; see
          Multiple samples below.
        </p>
      </fieldset>

      <div>
        <div role="group" aria-label="Plate layout view" className="inline-flex flex-wrap rounded-md border p-0.5">
          {(
            [
              ["edit", "Edit layout"],
              ["preview", "Preview with targets"],
              ["multi", "Multiple samples"],
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
                  onClick={() => onChange(presetLayout(kit, parsedCounts))}
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
        ) : mode === "preview" ? (
          <div className="mt-4">
            <LayoutPreview tubes={kit.tubes} layout={layout} />
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              When a centre runs two samples on one plate, each tube gets a second set of{" "}
              {layout.counts.unknownReplicates} unknown wells right after the first, and the controls move along. Runs
              with several samples are split into one file per sample by each sample&apos;s identifier in the{" "}
              {SAMPLE_IDENTIFIER_COLUMNS.join(", ").replace(/, ([^,]*)$/, " or $1")} column: its collection date for
              multiple dates, or a site label (e.g. ETP, STP) for multiple sites.
            </p>
            {twoSamples ? (
              <LayoutPreview
                tubes={kit.tubes}
                layout={twoSamples.layout}
                sampleWells={twoSamples.sampleWells}
                showMode={false}
              />
            ) : (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                A second sample does not fit: it needs {layout.counts.unknownReplicates} more wells after each
                tube&apos;s last well in its {tubesAxis}. With this layout centres can only run one sample per plate.
                Use fewer replicates or controls, or leave space after each tube, to allow more.
              </p>
            )}
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
