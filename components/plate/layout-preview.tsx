"use client"

import { useState } from "react"
import { PlateGrid } from "@/components/plate/plate-grid"
import { ROLE_LABEL, ROLE_SHORT, fluorophoreDot, tubeColour } from "@/components/plate/kit-panel"
import type { KitTube } from "@/lib/kits/public"
import { MULTI_SAMPLE_MODES, samplesPerPlate, type PlateLayout, type SampleWells } from "@/lib/plate/layout"
import { cn } from "@/lib/utils"

/**
 * Read-only plate preview: each well shows its tube number, role and one dot
 * per fluorophore read there. Selecting a well lists its targets. With
 * `sampleWells`, unknown wells are labelled with their sample (S1, S2, ...).
 */
export function LayoutPreview({
  tubes,
  layout,
  sampleWells,
  showMode = true,
}: {
  tubes: KitTube[]
  layout: PlateLayout
  sampleWells?: SampleWells[]
  /** Name the dates-or-sites choice in the summary (off where it is only an example). */
  showMode?: boolean
}) {
  const [selected, setSelected] = useState<{ plate: number; well: string } | null>(null)
  const tubeIndex = new Map(tubes.map((t, i) => [t.name, i]))
  const multi = layout.plates.length > 1

  const detail = selected ? layout.plates[selected.plate]?.[selected.well] : undefined
  const detailTube = detail ? tubes[tubeIndex.get(detail.tube) ?? -1] : undefined
  const sampleOf = (plate: number, well: string) => sampleWells?.[plate]?.[well]
  const detailSample = selected ? sampleOf(selected.plate, selected.well) : undefined

  const samples = samplesPerPlate(layout.counts)
  const sampleMode = showMode ? MULTI_SAMPLE_MODES.find((m) => m.value === layout.multiSample?.mode) : undefined

  return (
    <div className="space-y-4">
      {samples > 1 ? (
        <p className="text-sm">
          {samples} samples per plate{sampleMode ? ` (${sampleMode.label.toLowerCase()})` : ""}, each with{" "}
          {layout.counts.unknownReplicates} replicates in every tube, sharing the plate&apos;s controls.{" "}
          {sampleWells
            ? "S1, S2... show one way to place them: samples are told apart by their identifier, so they may sit in any of the unknown wells."
            : "Samples are told apart by their identifier, not their wells."}
        </p>
      ) : null}
      {layout.plates.map((wells, p) => (
        <figure key={p} className="space-y-2">
          {multi ? <figcaption className="text-sm font-medium">Plate {p + 1}</figcaption> : null}
          <PlateGrid
            label={multi ? `Plate ${p + 1} preview` : "Plate preview"}
            selected={selected?.plate === p ? selected.well : null}
            onWell={(id) => setSelected({ plate: p, well: id })}
            well={(id) => {
              const w = wells[id]
              if (!w) return { description: `${id}: empty` }
              const ti = tubeIndex.get(w.tube) ?? -1
              const tube = tubes[ti]
              const targets = tube?.targets.map((t) => `${t.name} (${t.fluorophore})`).join(", ") ?? ""
              const sample = sampleOf(p, id)
              const role = sample ? `sample ${sample}` : ROLE_LABEL[w.role].toLowerCase()
              return {
                description: `${id}: ${w.tube}, ${role}. ${targets}`,
                className: tubeColour(Math.max(ti, 0)),
                children: (
                  <>
                    <span className="font-semibold">
                      {ti + 1}·{sample ? `S${sample}` : ROLE_SHORT[w.role]}
                    </span>
                    <span className="mt-1 flex gap-0.5">
                      {tube?.targets.map((t) => (
                        <span key={t.name} className={cn("size-1.5 rounded-full", fluorophoreDot(t.fluorophore))} />
                      ))}
                    </span>
                  </>
                ),
              }
            }}
          />
        </figure>
      ))}

      <div aria-live="polite" className="min-h-16 rounded-md border bg-muted/30 p-3 text-sm">
        {selected && detail && detailTube ? (
          <>
            <p className="font-medium">
              {multi ? `Plate ${selected.plate + 1}, ` : ""}
              {selected.well}: {detail.tube} · {detailSample ? `Sample ${detailSample}` : ROLE_LABEL[detail.role]}
            </p>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {detailTube.targets.map((t) => (
                <li key={t.name} className="flex items-center gap-1.5">
                  <span aria-hidden className={cn("size-2 rounded-full", fluorophoreDot(t.fluorophore))} />
                  <span className="font-mono text-xs">{t.name}</span>
                  <span className="text-muted-foreground">{t.fluorophore}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-muted-foreground">
            {selected ? `${selected.well} is empty.` : "Select a well to see the targets and fluorophores read in it."}
          </p>
        )}
      </div>

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {sampleWells ? "S1, S2 = unknown wells of sample 1, sample 2" : "U = unknown sample"}, PC = positive control, NC =
          negative control.
        </span>
        {[
          ["FAM", "FAM"],
          ["VIC/HEX", "VIC/HEX"],
          ["Texas Red/ROX", "Texas Red/ROX"],
          ["Cy5", "Cy5"],
        ].map(([dye, label]) => (
          <span key={dye} className="flex items-center gap-1">
            <span aria-hidden className={cn("size-2 rounded-full", fluorophoreDot(dye))} />
            {label}
          </span>
        ))}
      </p>
    </div>
  )
}
