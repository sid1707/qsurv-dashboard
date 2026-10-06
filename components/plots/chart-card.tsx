"use client"

import { useEffect, useRef, useSyncExternalStore } from "react"
import { Download, Image as ImageIcon } from "lucide-react"
import { BoxplotChart, HeatmapChart, LineChart, ScatterChart } from "echarts/charts"
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent, VisualMapComponent } from "echarts/components"
import * as echarts from "echarts/core"
import { CanvasRenderer } from "echarts/renderers"
import { buttonVariants } from "@/components/ui/button"
import { INK, type Mode } from "@/lib/plots/palette"
import { tableToCsv, type DataTable } from "@/lib/plots/summary"

echarts.use([LineChart, BoxplotChart, HeatmapChart, ScatterChart, GridComponent, LegendComponent, TitleComponent, TooltipComponent, VisualMapComponent, CanvasRenderer])

export type ChartOption = echarts.EChartsCoreOption

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => observer.disconnect()
}

/** Light or dark, following the app's `.dark` class on <html>. */
export function useChartMode(): Mode {
  return useSyncExternalStore(
    subscribeTheme,
    () => (document.documentElement.classList.contains("dark") ? "dark" : "light"),
    () => "light"
  )
}

function save(href: string, filename: string) {
  const a = document.createElement("a")
  a.href = href
  a.download = filename
  a.click()
}

/**
 * One chart with its PNG and CSV downloads and a table view of the same data.
 * The option is built per theme, so marks and ink are stepped for the surface.
 */
export function ChartCard({
  title,
  description,
  filename,
  table,
  option,
  height = 360,
  empty,
}: {
  title: string
  description: string
  filename: string
  table: DataTable
  option: ChartOption
  height?: number
  empty?: string | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  const mode = useChartMode()

  useEffect(() => {
    if (!ref.current || empty) return
    const instance = echarts.init(ref.current, null, { renderer: "canvas" })
    chart.current = instance
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(ref.current)
    return () => {
      observer.disconnect()
      instance.dispose()
      chart.current = null
    }
  }, [empty])

  useEffect(() => {
    chart.current?.setOption(
      { ...option, title: { text: title, show: false, left: 0, top: 0, textStyle: { color: INK[mode].text, fontSize: 14 } } },
      { notMerge: true }
    )
  }, [option, title, mode, empty])

  const downloadPng = () => {
    const instance = chart.current
    if (!instance) return
    // The title is drawn only into the exported image; the page has its own heading.
    instance.setOption({ title: { show: true }, animation: false })
    const url = instance.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: INK[mode].surface })
    instance.setOption({ title: { show: false } })
    save(url, `${filename}.png`)
  }

  const downloadCsv = () => {
    // The BOM makes Excel read the file as UTF-8, as the compiled data export does.
    const url = URL.createObjectURL(new Blob([`﻿${tableToCsv(table)}`], { type: "text/csv;charset=utf-8" }))
    save(url, `${filename}.csv`)
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={downloadPng} disabled={!!empty} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ImageIcon className="size-4" aria-hidden /> PNG
          </button>
          <button type="button" onClick={downloadCsv} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Download className="size-4" aria-hidden /> CSV
          </button>
        </div>
      </div>

      {empty ? (
        <p className="mt-4 rounded-md border border-dashed px-3 py-10 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div ref={ref} role="img" aria-label={title} className="mt-4 w-full" style={{ height }} />
      )}

      {table.rows.length ? (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground">Show data table</summary>
          <div className="mt-2 max-h-72 overflow-auto rounded-md border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  {table.header.map((h) => (
                    <th key={h} scope="col" className="px-2 py-1.5 font-medium">
                      {h.replace(/_/g, " ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    {r.map((c, j) => (
                      <td key={j} className="px-2 py-1 tabular-nums">
                        {c ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  )
}
