"use client"

import { PLATE_COLUMNS, PLATE_ROWS } from "@/lib/plate/layout"
import { cn } from "@/lib/utils"

export type WellView = {
  /** Read by screen readers and shown as a tooltip, e.g. "B4: NVK, positive control". */
  description: string
  className?: string
  children?: React.ReactNode
}

/**
 * A 96-well plate (rows A–H, columns 1–12). Scrolls sideways inside its own box
 * on narrow screens. With onWell, wells are buttons: click or Enter selects one,
 * and dragging with the mouse paints across wells.
 */
export function PlateGrid({
  label,
  well,
  onWell,
  selected,
}: {
  label: string
  well: (id: string) => WellView
  onWell?: (id: string) => void
  selected?: string | null
}) {
  return (
    <div className="max-w-full overflow-x-auto pb-1">
      <table className="border-separate border-spacing-1 text-xs select-none" aria-label={label}>
        <thead>
          <tr>
            <th />
            {PLATE_COLUMNS.map((c) => (
              <th key={c} scope="col" className="w-10 font-normal text-muted-foreground">
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
                const id = `${r}${c}`
                const view = well(id)
                const content = (
                  <>
                    <span className="sr-only">{view.description}</span>
                    <span aria-hidden className="flex flex-col items-center justify-center leading-none">
                      {view.children}
                    </span>
                  </>
                )
                const cellClass = cn(
                  "flex size-10 items-center justify-center rounded-md border text-[10px]",
                  view.className ?? "border-dashed bg-background text-muted-foreground",
                  selected === id && "ring-2 ring-ring ring-offset-1 ring-offset-background"
                )
                return (
                  <td key={id} className="p-0">
                    {onWell ? (
                      <button
                        type="button"
                        title={view.description}
                        className={cn(cellClass, "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                        onPointerDown={(e) => {
                          if (e.pointerType === "mouse" && e.button === 0) onWell(id)
                        }}
                        onPointerEnter={(e) => {
                          if (e.pointerType === "mouse" && e.buttons === 1) onWell(id)
                        }}
                        onClick={(e) => {
                          // Mouse clicks were handled on pointer down; this covers touch and keyboard.
                          if (e.detail === 0 || (e.nativeEvent as PointerEvent).pointerType !== "mouse") onWell(id)
                        }}
                      >
                        {content}
                      </button>
                    ) : (
                      <div title={view.description} className={cellClass}>
                        {content}
                      </div>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
