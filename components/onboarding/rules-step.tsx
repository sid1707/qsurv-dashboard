"use client"

import type { KitPanel } from "@/lib/kits/public"
import {
  availableOptions,
  availableRules,
  type RuleDefinition,
  type RuleSetting,
  type RuleSettings,
  type RuleStage,
} from "@/lib/rules/catalog"
import { cn } from "@/lib/utils"

const STAGES: { stage: RuleStage; field: "qcRules" | "compileRules"; title: string; intro: string }[] = [
  {
    stage: "qc",
    field: "qcRules",
    title: "Quality checks",
    intro: "Run on every uploaded file. Errors block the upload; warnings must be acknowledged by the centre.",
  },
  {
    stage: "compile",
    field: "compileRules",
    title: "Compilation",
    intro: "Applied when approved files are compiled into project results.",
  },
]

export function RulesStep({
  kit,
  qcRules,
  compileRules,
  errors,
  onChange,
}: {
  kit: KitPanel
  qcRules: RuleSettings
  compileRules: RuleSettings
  errors: Record<string, string>
  onChange: (field: "qcRules" | "compileRules", settings: RuleSettings, clearKey?: string) => void
}) {
  const current = { qcRules, compileRules }
  return (
    <div className="space-y-6 md:col-span-2">
      <p className="text-sm text-muted-foreground">
        Choose the rules this project applies to uploaded qPCR data. Values are pre-filled from the kit insert; change
        them only if your protocol differs.
      </p>
      {STAGES.map(({ stage, field, title, intro }) => (
        <fieldset key={stage} className="space-y-3">
          <legend className="text-base font-semibold">{title}</legend>
          <p className="text-xs text-muted-foreground">{intro}</p>
          <ul className="divide-y rounded-md border">
            {availableRules(kit, stage).map((rule) => {
              const setting = current[field][rule.id] ?? { enabled: false, params: {} }
              return (
                <RuleRow
                  key={rule.id}
                  kit={kit}
                  rule={rule}
                  field={field}
                  setting={setting}
                  errors={errors}
                  onChange={(next, clearKey) => onChange(field, { ...current[field], [rule.id]: next }, clearKey)}
                />
              )
            })}
          </ul>
        </fieldset>
      ))}
    </div>
  )
}

function RuleRow({
  kit,
  rule,
  field,
  setting,
  errors,
  onChange,
}: {
  kit: Pick<KitPanel, "tubes">
  rule: RuleDefinition
  field: string
  setting: RuleSetting
  errors: Record<string, string>
  onChange: (setting: RuleSetting, clearKey?: string) => void
}) {
  const id = `${field}.${rule.id}`
  const enabled = rule.locked || setting.enabled
  return (
    <li className="p-3">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={enabled}
          disabled={rule.locked}
          aria-describedby={`${id}-description`}
          onChange={(e) => onChange({ ...setting, enabled: e.target.checked })}
          className="mt-1 size-4 shrink-0 accent-primary"
        />
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {rule.label}
            {rule.severity ? (
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide",
                  rule.severity === "error"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                )}
              >
                {rule.severity}
              </span>
            ) : null}
            {rule.locked ? <span className="text-xs font-normal text-muted-foreground">Always on</span> : null}
          </label>
          <p id={`${id}-description`} className="mt-0.5 text-xs text-muted-foreground">
            {rule.description}
          </p>

          {enabled && rule.params.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-3">
              {rule.params.map((p) => {
                const key = `${id}.${p.key}`
                const value = setting.params[p.key]
                return (
                  <div key={p.key} className="space-y-1">
                    <label htmlFor={key} className="block text-xs">
                      {p.label}
                    </label>
                    <input
                      id={key}
                      type="number"
                      inputMode="decimal"
                      min={p.min}
                      max={p.max}
                      step={p.step}
                      value={value === undefined || Number.isNaN(value) ? "" : value}
                      aria-invalid={errors[key] ? true : undefined}
                      aria-describedby={errors[key] ? `${key}-error` : undefined}
                      onChange={(e) =>
                        onChange(
                          {
                            ...setting,
                            params: { ...setting.params, [p.key]: e.target.value === "" ? Number.NaN : Number(e.target.value) },
                          },
                          key
                        )
                      }
                      className="h-9 w-28 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive"
                    />
                    {errors[key] ? (
                      <p id={`${key}-error`} className="text-xs text-destructive">
                        {errors[key]}
                      </p>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}

          {enabled
            ? (rule.choices ?? []).map((choice) => {
                const key = `${id}.${choice.key}`
                const options = availableOptions(kit, choice)
                const selected = setting.choices?.[choice.key] ?? choice.default
                return (
                  <fieldset key={choice.key} className="mt-2 space-y-1.5" aria-describedby={errors[key] ? `${key}-error` : undefined}>
                    <legend className="text-xs">{choice.label}</legend>
                    {options.map((o) => {
                      const optionId = `${key}.${o.value}`
                      return (
                        <div key={o.value} className="flex items-start gap-2">
                          <input
                            id={optionId}
                            type="radio"
                            name={key}
                            value={o.value}
                            checked={selected === o.value}
                            aria-describedby={`${optionId}-description`}
                            onChange={() => onChange({ ...setting, choices: { ...setting.choices, [choice.key]: o.value } }, key)}
                            className="mt-0.5 size-4 shrink-0 accent-primary"
                          />
                          <div className="min-w-0">
                            <label htmlFor={optionId} className="text-sm">
                              {o.label}
                            </label>
                            <p id={`${optionId}-description`} className="text-xs text-muted-foreground">
                              {o.description}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                    {options.length < choice.options.length ? (
                      <p className="text-xs text-muted-foreground">
                        Other methods need standard curves for every target and the endogenous control in this kit.
                      </p>
                    ) : null}
                    {errors[key] ? (
                      <p id={`${key}-error`} className="text-xs text-destructive">
                        {errors[key]}
                      </p>
                    ) : null}
                  </fieldset>
                )
              })
            : null}

          {enabled && setting.targetOverrides ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Kit-specific cut-offs:{" "}
              {Object.entries(setting.targetOverrides)
                .map(([target, ct]) => `${target} ${ct}`)
                .join(", ")}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  )
}
