import type { KitTube } from "@/lib/kits/public"
import { WELL_ROLES, type WellRole } from "@/lib/plate/layout"
import { cn } from "@/lib/utils"

// Tube colours cycle; the tube number is always printed too, so colour is never the only cue.
const TUBE_COLOURS = [
  "border-sky-400 bg-sky-100 text-sky-950 dark:border-sky-600 dark:bg-sky-950 dark:text-sky-100",
  "border-amber-400 bg-amber-100 text-amber-950 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-100",
  "border-emerald-400 bg-emerald-100 text-emerald-950 dark:border-emerald-600 dark:bg-emerald-950 dark:text-emerald-100",
  "border-rose-400 bg-rose-100 text-rose-950 dark:border-rose-600 dark:bg-rose-950 dark:text-rose-100",
  "border-violet-400 bg-violet-100 text-violet-950 dark:border-violet-600 dark:bg-violet-950 dark:text-violet-100",
  "border-lime-400 bg-lime-100 text-lime-950 dark:border-lime-600 dark:bg-lime-950 dark:text-lime-100",
  "border-orange-400 bg-orange-100 text-orange-950 dark:border-orange-600 dark:bg-orange-950 dark:text-orange-100",
  "border-cyan-400 bg-cyan-100 text-cyan-950 dark:border-cyan-600 dark:bg-cyan-950 dark:text-cyan-100",
  "border-fuchsia-400 bg-fuchsia-100 text-fuchsia-950 dark:border-fuchsia-600 dark:bg-fuchsia-950 dark:text-fuchsia-100",
  "border-stone-400 bg-stone-200 text-stone-950 dark:border-stone-500 dark:bg-stone-800 dark:text-stone-100",
]

export function tubeColour(index: number) {
  return TUBE_COLOURS[index % TUBE_COLOURS.length]
}

/** Dot colours that echo the usual channel colours. */
export function fluorophoreDot(fluorophore: string) {
  const f = fluorophore.toLowerCase()
  if (f.includes("fam")) return "bg-green-500"
  if (f.includes("hex") || f.includes("vic") || f.includes("yakima")) return "bg-yellow-400"
  if (f.includes("rox") || f.includes("texas")) return "bg-orange-500"
  if (f.includes("cy5")) return "bg-red-600"
  return "bg-slate-400"
}

export const ROLE_LABEL: Record<WellRole, string> = Object.fromEntries(
  WELL_ROLES.map((r) => [r.value, r.label])
) as Record<WellRole, string>
export const ROLE_SHORT: Record<WellRole, string> = Object.fromEntries(
  WELL_ROLES.map((r) => [r.value, r.short])
) as Record<WellRole, string>

const CONTROL_LABEL: Record<string, string> = {
  none: "Target",
  exogenous_control: "Exogenous internal control",
  endogenous_control: "Endogenous control",
  internal_control: "Internal control",
  positive_control: "Positive control",
  negative_control: "Negative control",
  ntc: "No-template control",
}

export const controlTypeLabel = (value: string) => CONTROL_LABEL[value] ?? value

/** The kit's targets grouped by tube, with the fluorophore each must be read in. */
export function KitPanelTable({ tubes, caption }: { tubes: KitTube[]; caption?: string }) {
  return (
    <div className="max-w-full overflow-x-auto rounded-md border">
      <table className="w-full min-w-[28rem] text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Tube</th>
            <th scope="col" className="px-3 py-2 font-medium">Target name</th>
            <th scope="col" className="px-3 py-2 font-medium">Fluorophore</th>
            <th scope="col" className="px-3 py-2 font-medium">Type</th>
          </tr>
        </thead>
        <tbody>
          {tubes.map((tube, ti) =>
            tube.targets.map((t, i) => (
              <tr key={`${tube.name}-${t.name}`} className={cn(i === 0 && "border-t")}>
                {i === 0 ? (
                  <th scope="rowgroup" rowSpan={tube.targets.length} className="px-3 py-1.5 text-left align-top font-medium">
                    <span className="flex items-center gap-2">
                      <span className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded border text-[10px]", tubeColour(ti))}>
                        {ti + 1}
                      </span>
                      {tube.name}
                    </span>
                  </th>
                ) : null}
                <td className="px-3 py-1.5 font-mono text-xs">{t.name}</td>
                <td className="px-3 py-1.5">
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className={cn("size-2 rounded-full", fluorophoreDot(t.fluorophore))} />
                    {t.fluorophore}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-muted-foreground">{controlTypeLabel(t.controlType)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
