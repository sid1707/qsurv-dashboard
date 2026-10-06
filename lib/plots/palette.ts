/**
 * Chart colours, shared by every plot so a target keeps one colour everywhere.
 * Categorical slots are the dataviz reference palette in its validated order
 * (CVD-checked for adjacent series in light and dark). A target's slot is its
 * position in the kit panel, so filters never repaint it. Past eight targets
 * the rest share a neutral grey and are told apart by the legend and tooltip.
 */
export const SERIES = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
} as const

export const OVERFLOW = { light: "#8a8984", dark: "#8a8984" } as const

/** One-hue blue ramp (light -> dark) for magnitude: the positivity heatmap. */
export const SEQUENTIAL = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"]

export const INK = {
  light: { text: "#0b0b0b", muted: "#52514e", grid: "#e6e5e0", surface: "#ffffff", empty: "#f0efec" },
  dark: { text: "#ffffff", muted: "#c3c2b7", grid: "#383835", surface: "#1a1a19", empty: "#2a2a28" },
} as const

export type Mode = keyof typeof INK

/** Colour of a target by its index in the kit panel (not in the filtered list). */
export function targetColour(index: number, mode: Mode): string {
  return index >= 0 && index < SERIES[mode].length ? SERIES[mode][index] : OVERFLOW[mode]
}
