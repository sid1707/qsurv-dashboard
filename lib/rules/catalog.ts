import type { KitPanel } from "@/lib/kits/public"

/**
 * Data rules a project can switch on at onboarding. Each mirrors a rule in
 * vrdl-next-platform (src/lib/validation for quality checks, lib/compile for
 * compilation). The catalogue holds the ids, wording and parameter limits; the
 * kit's rule_defaults (from its insert) supply kit-specific default values.
 */

export type RuleStage = "qc" | "compile"
type Requirement = "exogenous_control" | "endogenous_control" | "std_curves"

export type RuleParam = {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
}

export type RuleDefinition = {
  id: string
  stage: RuleStage
  label: string
  description: string
  /** Quality checks only: an error blocks the upload, a warning needs acknowledging. */
  severity?: "error" | "warning"
  /** Always on: the data cannot be processed without it. */
  locked?: boolean
  requires?: Requirement
  /** Per-target cut-offs from the kit replace the default for those targets. */
  targetOverrides?: boolean
  params: RuleParam[]
}

export type RuleSetting = {
  enabled: boolean
  params: Record<string, number>
  targetOverrides?: Record<string, number>
}
export type RuleSettings = Record<string, RuleSetting>

const ct = (label: string, value: number): RuleParam => ({ key: "ct", label, min: 0, max: 50, step: 0.5, default: value })

export const RULES: RuleDefinition[] = [
  // ---------- Quality checks ----------
  {
    id: "filename_format",
    stage: "qc",
    label: "File name format",
    description:
      "Results exports and run files are named <Centre ID>_<Centre name>_<Location>_<DDMMYY or DDMMYYYY>, e.g. C01_AIIMS_NewDelhi_01102026.csv, with one date per sample when a plate carries samples from several dates. The project admin gives each centre its ID when adding its users; the centre name and location are fixed for the centre and written without spaces.",
    severity: "error",
    locked: true,
    params: [],
  },
  {
    id: "required_columns",
    stage: "qc",
    label: "Required columns",
    description: "The export has sample, target, Ct/Cq and fluorophore columns (common header names are recognised).",
    severity: "error",
    locked: true,
    params: [],
  },
  {
    id: "known_targets",
    stage: "qc",
    label: "Known target names",
    description: "Every target name in the file is one of the kit's targets or their aliases.",
    severity: "error",
    params: [],
  },
  {
    id: "panel_complete",
    stage: "qc",
    label: "Complete panel",
    description: "Every target in the kit appears in the file.",
    severity: "error",
    params: [],
  },
  {
    id: "target_fluorophore_mapping",
    stage: "qc",
    label: "Target–fluorophore mapping",
    description: "Each target is read in the fluorophore the kit assigns to it.",
    severity: "error",
    params: [],
  },
  {
    id: "replicate_configuration",
    stage: "qc",
    label: "Replicate configuration",
    description: "Each target has the number of unknown replicates, positive and negative controls set in the plate layout.",
    severity: "error",
    params: [],
  },
  {
    id: "plate_layout",
    stage: "qc",
    label: "Plate layout",
    description:
      "Each well holds the tube and the role (sample, positive or negative control) the project's plate layout gives it.",
    severity: "error",
    params: [],
  },
  {
    id: "pc_present",
    stage: "qc",
    label: "Positive control present",
    description: "The run includes positive control wells.",
    severity: "error",
    params: [],
  },
  {
    id: "ntc_present",
    stage: "qc",
    label: "Negative control present",
    description: "The run includes negative control (NTC) wells.",
    severity: "error",
    params: [],
  },
  {
    id: "ntc_amplification",
    stage: "qc",
    label: "Negative control amplification",
    description: "Warn when a negative control well amplifies at or below the cut-off Ct.",
    severity: "warning",
    params: [ct("Cut-off Ct", 38)],
  },
  {
    id: "exogenous_ic_present",
    stage: "qc",
    label: "Exogenous internal control present",
    description: "The exogenous internal control (e.g. MS-2) is reported in the file.",
    severity: "error",
    requires: "exogenous_control",
    params: [],
  },
  {
    id: "exogenous_ic_amplified",
    stage: "qc",
    label: "Exogenous internal control amplified",
    description: "Warn when no exogenous internal control well amplifies at or below the cut-off Ct.",
    severity: "warning",
    requires: "exogenous_control",
    params: [ct("Cut-off Ct", 35)],
  },
  {
    id: "endogenous_ic_present",
    stage: "qc",
    label: "Endogenous control present",
    description: "The endogenous control (e.g. Enterobacter spp., PMMoV) is reported in the file.",
    severity: "error",
    requires: "endogenous_control",
    params: [],
  },
  {
    id: "endogenous_ic_high_ct",
    stage: "qc",
    label: "Endogenous control Ct too high",
    description: "Warn when the mean endogenous control Ct of unknown samples is above the cut-off (undetermined counts as the undetermined Ct).",
    severity: "warning",
    requires: "endogenous_control",
    params: [ct("Cut-off Ct", 35), { key: "undeterminedCt", label: "Undetermined Ct", min: 30, max: 50, step: 1, default: 40 }],
  },
  {
    id: "low_ct_warning",
    stage: "qc",
    label: "Suspiciously low Ct",
    description: "Warn when an unknown sample has a Ct below the cut-off, which usually means an artefact.",
    severity: "warning",
    targetOverrides: true,
    params: [ct("Default cut-off Ct", 10)],
  },
  {
    id: "runfile_required",
    stage: "qc",
    label: "Run file required",
    description: "The instrument run file is uploaded with the CSV export and its name matches.",
    severity: "error",
    params: [],
  },
  {
    id: "duplicate_upload",
    stage: "qc",
    label: "Duplicate upload",
    description: "The same file and collection date has not already been submitted by the centre.",
    severity: "error",
    params: [],
  },

  // ---------- Compilation ----------
  {
    id: "unknown_only_filter",
    stage: "compile",
    label: "Use unknown samples only",
    description: "Positive and negative control wells are left out of compiled results.",
    locked: true,
    params: [],
  },
  {
    id: "undetermined_to_max",
    stage: "compile",
    label: "Undetermined as maximum Ct",
    description: "Undetermined or blank Ct values, and values above the maximum, are set to the maximum Ct.",
    params: [ct("Maximum Ct", 40)],
  },
  {
    id: "low_ct_clamp",
    stage: "compile",
    label: "Low-Ct artefact removal",
    description: "A Ct below the cut-off is treated as an artefact and replaced with the replacement Ct.",
    targetOverrides: true,
    params: [ct("Default cut-off Ct", 14), { key: "replacementCt", label: "Replacement Ct", min: 0, max: 50, step: 1, default: 40 }],
  },
  {
    id: "outlier_removal",
    stage: "compile",
    label: "Replicate outlier removal",
    description: "While the replicate SD is above the limit, drop the replicate farthest from the mean, keeping a minimum number.",
    params: [
      { key: "maxSd", label: "Maximum SD", min: 0.1, max: 20, step: 0.1, default: 5 },
      { key: "minReplicates", label: "Minimum replicates kept", min: 1, max: 12, step: 1, default: 2 },
    ],
  },
  {
    id: "replicate_mean_sd",
    stage: "compile",
    label: "Replicate mean and SD",
    description: "Each target's Ct is the mean of its kept replicates, with their standard deviation.",
    locked: true,
    params: [],
  },
  {
    id: "copy_number_std_curve",
    stage: "compile",
    label: "Copy number from standard curve",
    description: "Copies are calculated from each target's standard curve (slope and intercept from the kit).",
    requires: "std_curves",
    params: [],
  },
  {
    id: "endogenous_gate",
    stage: "compile",
    label: "Skip compilation if endogenous control fails",
    description: "A file is not compiled when the endogenous control is missing or its mean Ct is above the cut-off.",
    requires: "endogenous_control",
    params: [ct("Cut-off Ct", 35)],
  },
  {
    id: "endogenous_normalization",
    stage: "compile",
    label: "Normalise to endogenous control",
    description: "Reports each target relative to the endogenous control: 2^(control Ct − target Ct).",
    requires: "endogenous_control",
    params: [],
  },
]

export const RULES_BY_ID = new Map(RULES.map((r) => [r.id, r]))

function meets(kit: Pick<KitPanel, "tubes">, requirement: Requirement | undefined) {
  const targets = kit.tubes.flatMap((t) => t.targets)
  switch (requirement) {
    case undefined:
      return true
    case "exogenous_control":
    case "endogenous_control":
      return targets.some((t) => t.controlType === requirement)
    case "std_curves": {
      const measured = targets.filter((t) => t.controlType === "none")
      return measured.length > 0 && measured.every((t) => t.hasStdCurve)
    }
  }
}

/** Rules that make sense for this kit, in catalogue order. */
export function availableRules(kit: Pick<KitPanel, "tubes">, stage: RuleStage) {
  return RULES.filter((r) => r.stage === stage && meets(kit, r.requires))
}

const inRange = (p: RuleParam, v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= p.min && v <= p.max

function kitOverrides(kit: Pick<KitPanel, "ruleDefaults">, rule: RuleDefinition) {
  const raw = kit.ruleDefaults[rule.id]?.targetOverrides
  if (!rule.targetOverrides || !raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const out: Record<string, number> = {}
  for (const [target, value] of Object.entries(raw)) {
    if (typeof value === "number" && Number.isFinite(value)) out[target] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function defaultSetting(kit: Pick<KitPanel, "ruleDefaults">, rule: RuleDefinition): RuleSetting {
  const params: Record<string, number> = {}
  for (const p of rule.params) {
    const fromKit = kit.ruleDefaults[rule.id]?.[p.key]
    params[p.key] = inRange(p, fromKit) ? fromKit : p.default
  }
  const overrides = kitOverrides(kit, rule)
  return overrides ? { enabled: true, params, targetOverrides: overrides } : { enabled: true, params }
}

/** Every available rule switched on, with the kit's defaults. */
export function defaultRuleSettings(kit: Pick<KitPanel, "tubes" | "ruleDefaults">, stage: RuleStage): RuleSettings {
  return Object.fromEntries(availableRules(kit, stage).map((r) => [r.id, defaultSetting(kit, r)]))
}

/**
 * Validates settings from the form against the kit. Unknown or unavailable
 * rules are dropped, missing ones fall back to the kit default, locked rules
 * stay on, and per-target overrides always come from the kit. Errors are keyed
 * `<field>.<ruleId>.<param>` for the form.
 */
export function parseRuleSettings(
  value: unknown,
  kit: Pick<KitPanel, "tubes" | "ruleDefaults">,
  stage: RuleStage,
  field: string
): { ok: true; data: RuleSettings } | { ok: false; errors: Record<string, string> } {
  const input = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const data: RuleSettings = {}
  const errors: Record<string, string> = {}

  for (const rule of availableRules(kit, stage)) {
    const fallback = defaultSetting(kit, rule)
    const raw = input[rule.id]
    const given = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Partial<RuleSetting>) : {}
    const enabled = rule.locked ? true : typeof given.enabled === "boolean" ? given.enabled : fallback.enabled
    const params: Record<string, number> = {}
    for (const p of rule.params) {
      const v = given.params?.[p.key]
      if (v === undefined) {
        params[p.key] = fallback.params[p.key]
      } else if (inRange(p, v)) {
        params[p.key] = v
      } else {
        params[p.key] = fallback.params[p.key]
        if (enabled) errors[`${field}.${rule.id}.${p.key}`] = `${p.label} must be between ${p.min} and ${p.max}.`
      }
    }
    data[rule.id] = fallback.targetOverrides
      ? { enabled, params, targetOverrides: fallback.targetOverrides }
      : { enabled, params }
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, data }
}
