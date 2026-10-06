"use client"

import { useMemo } from "react"
import { ChartCard, useChartMode, type ChartOption } from "@/components/plots/chart-card"
import { INK, SEQUENTIAL, targetColour, type Mode } from "@/lib/plots/palette"
import { ctTable, detectionTable, heatmapTable, type PlotData } from "@/lib/plots/summary"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function periodLabel(key: string, period: PlotData["period"]) {
  const [y, m, d] = key.split("-")
  return period === "month" ? `${MONTHS[Number(m) - 1]} ${y}` : `${d} ${MONTHS[Number(m) - 1]} ${y}`
}

const fmtPct = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(1)}%`)

function axes(mode: Mode) {
  const ink = INK[mode]
  const axisLabel = { color: ink.muted, fontSize: 12 }
  return {
    category: { axisLine: { lineStyle: { color: ink.grid } }, axisTick: { show: false }, axisLabel },
    value: { splitLine: { lineStyle: { color: ink.grid } }, axisLabel, nameTextStyle: { color: ink.muted } },
    tooltip: {
      backgroundColor: ink.surface,
      borderColor: ink.grid,
      textStyle: { color: ink.text, fontSize: 12 },
      extraCssText: "box-shadow: 0 2px 8px rgb(0 0 0 / 0.15);",
    },
    legend: { top: 28, textStyle: { color: ink.muted }, itemWidth: 14, itemHeight: 8, type: "scroll" as const },
  }
}

function detectionOption(d: PlotData, colours: string[], mode: Mode): ChartOption {
  const a = axes(mode)
  return {
    animationDuration: 300,
    grid: { left: 48, right: 16, top: 72, bottom: 32, containLabel: true },
    legend: { ...a.legend, data: d.targets },
    tooltip: {
      ...a.tooltip,
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: INK[mode].muted } },
      formatter: (items: { seriesName: string; dataIndex: number; marker: string }[]) => {
        if (!items.length) return ""
        const i = items[0].dataIndex
        const lines = items
          .map((it) => ({ it, c: d.detection[it.seriesName][i] }))
          .filter(({ c }) => c.tested)
          .map(({ it, c }) => `${it.marker}${it.seriesName}: <b>${fmtPct(c.rate)}</b> (${c.detected}/${c.tested})`)
        return `${periodLabel(d.periods[i], d.period)}<br/>${lines.join("<br/>") || "No samples"}`
      },
    },
    xAxis: { type: "category", data: d.periods.map((p) => periodLabel(p, d.period)), boundaryGap: false, ...a.category },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      name: "Detected (%)",
      nameLocation: "middle",
      nameGap: 40,
      ...a.value,
      axisLabel: { ...a.value.axisLabel, formatter: "{value}%" },
    },
    series: d.targets.map((t, i) => ({
      name: t,
      type: "line",
      // A period with no samples is a gap, not a zero.
      data: d.detection[t].map((c) => (c.rate === null ? null : Math.round(c.rate * 1000) / 10)),
      connectNulls: false,
      symbol: "circle",
      symbolSize: 8,
      lineStyle: { width: 2 },
      itemStyle: { color: colours[i], borderColor: INK[mode].surface, borderWidth: 2 },
      emphasis: { focus: "series" },
    })),
  }
}

function ctOption(d: PlotData, colours: string[], mode: Mode): ChartOption {
  const a = axes(mode)
  const outliers = d.targets.flatMap((t, i) => (d.ct[t]?.outliers ?? []).map((v) => ({ value: [i, v], itemStyle: { color: colours[i] } })))
  return {
    animationDuration: 300,
    grid: { left: 48, right: 16, top: 48, bottom: 32, containLabel: true },
    tooltip: {
      ...a.tooltip,
      trigger: "item",
      formatter: (p: { seriesType: string; dataIndex: number; value: number[] }) => {
        if (p.seriesType === "scatter") return `${d.targets[p.value[0]]}<br/>Outlier Cq: <b>${p.value[1].toFixed(2)}</b>`
        const t = d.targets[p.dataIndex]
        const b = d.ct[t]
        if (!b) return `${t}<br/>No detections`
        return [
          `<b>${t}</b> · n = ${b.n}`,
          `Upper whisker: ${b.max.toFixed(2)}`,
          `Q3: ${b.q3.toFixed(2)}`,
          `Median: <b>${b.median.toFixed(2)}</b>`,
          `Q1: ${b.q1.toFixed(2)}`,
          `Lower whisker: ${b.min.toFixed(2)}`,
        ].join("<br/>")
      },
    },
    xAxis: { type: "category", data: d.targets, ...a.category },
    yAxis: { type: "value", scale: true, name: "Cq", nameLocation: "middle", nameGap: 36, ...a.value },
    series: [
      {
        name: "Cq",
        type: "boxplot",
        boxWidth: [12, 40],
        data: d.targets.map((t, i) => {
          const b = d.ct[t]
          return {
            value: b ? [b.min, b.q1, b.median, b.q3, b.max] : [],
            itemStyle: { color: `${colours[i]}33`, borderColor: colours[i], borderWidth: 2 },
          }
        }),
      },
      { name: "Outliers", type: "scatter", symbolSize: 8, data: outliers, itemStyle: { borderColor: INK[mode].surface, borderWidth: 2 } },
    ],
  }
}

function heatmapOption(d: PlotData, mode: Mode): ChartOption {
  const a = axes(mode)
  const ink = INK[mode]
  const data = d.centres.flatMap((c, y) =>
    d.targets.map((t, x) => {
      const cell = d.heatmap[c.id][t]
      const pct = cell.rate === null ? null : Math.round(cell.rate * 1000) / 10
      return {
        value: [x, y, pct ?? "-"],
        // Untested cells sit outside the colour scale, in the neutral surface step.
        itemStyle: pct === null ? { color: ink.empty } : undefined,
        label: { color: pct === null ? ink.muted : pct >= 50 ? "#ffffff" : "#0b0b0b" },
      }
    })
  )
  return {
    animationDuration: 300,
    grid: { left: 16, right: 16, top: 16, bottom: 64, containLabel: true },
    tooltip: {
      ...a.tooltip,
      trigger: "item",
      formatter: (p: { value: [number, number, number | string] }) => {
        const c = d.centres[p.value[1]]
        const t = d.targets[p.value[0]]
        const cell = d.heatmap[c.id][t]
        return `${c.label}<br/>${t}: <b>${fmtPct(cell.rate)}</b> (${cell.detected}/${cell.tested})`
      },
    },
    xAxis: { type: "category", data: d.targets, ...a.category, splitArea: { show: false } },
    yAxis: { type: "category", data: d.centres.map((c) => c.label), inverse: true, ...a.category },
    visualMap: {
      min: 0,
      max: 100,
      calculable: false,
      orient: "horizontal",
      left: "center",
      bottom: 8,
      itemHeight: 160,
      itemWidth: 12,
      text: ["100% positive", "0%"],
      textStyle: { color: ink.muted },
      inRange: { color: SEQUENTIAL },
      dimension: 2,
    },
    series: [
      {
        type: "heatmap",
        data,
        label: { show: true, fontSize: 12, formatter: (p: { value: [number, number, number | string] }) => (p.value[2] === "-" ? "–" : `${p.value[2]}%`) },
        itemStyle: { borderColor: ink.surface, borderWidth: 2, borderRadius: 4 },
        emphasis: { itemStyle: { borderColor: ink.text, borderWidth: 2 } },
      },
    ],
  }
}

/** The three plots. `fileStem` names the downloads, e.g. "PROJ_plots" or "PROJ_C01_plots". */
export function PlotsView({ data, fileStem }: { data: PlotData; fileStem: string }) {
  const mode = useChartMode()
  // Targets arrive in kit panel order whatever the filters, so the index is a stable colour slot.
  const colours = useMemo(() => data.targets.map((_, i) => targetColour(i, mode)), [data.targets, mode])
  const detection = useMemo(() => detectionOption(data, colours, mode), [data, colours, mode])
  const ct = useMemo(() => ctOption(data, colours, mode), [data, colours, mode])
  const heat = useMemo(() => heatmapOption(data, mode), [data, mode])
  const noData = data.total === 0 ? "No compiled data for these filters yet." : null
  const periodWord = data.period === "week" ? "week" : "month"

  return (
    <div className="space-y-4">
      <ChartCard
        title="Detection rate per target over time"
        description={`Share of sample results with the target detected, by ${periodWord} of collection.${data.undated ? ` ${data.undated} result${data.undated === 1 ? "" : "s"} without a collection date are left out of this chart.` : ""}`}
        filename={`${fileStem}_detection_rate`}
        table={detectionTable(data)}
        option={detection}
        empty={noData ?? (data.periods.length === 0 ? "No results with a collection date." : null)}
      />
      <ChartCard
        title="Cq distribution per target"
        description="Cq of detected results only. Box: quartiles and median; whiskers reach 1.5 × IQR; dots are outliers."
        filename={`${fileStem}_cq_distribution`}
        table={ctTable(data)}
        option={ct}
        empty={noData ?? (Object.values(data.ct).every((b) => b === null) ? "No detected results to plot." : null)}
      />
      <ChartCard
        title="Positivity by centre and target"
        description="Share of each centre's sample results with the target detected. Grey cells have no results."
        filename={`${fileStem}_positivity_heatmap`}
        table={heatmapTable(data)}
        option={heat}
        height={Math.max(220, data.centres.length * 44 + 110)}
        empty={noData}
      />
    </div>
  )
}
