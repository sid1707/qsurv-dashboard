"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Plus, Trash2 } from "lucide-react"
import { checkShortCodeAction, submitOnboardingAction } from "@/app/onboarding/actions"
import { PlateLayoutStep } from "@/components/onboarding/plate-layout-step"
import { RulesStep } from "@/components/onboarding/rules-step"
import { KitPanelTable } from "@/components/plate/kit-panel"
import { Button } from "@/components/ui/button"
import { centreFileCode } from "@/lib/centres/file-name"
import type { KitSummary } from "@/lib/kits/public"
import { clearDraft, loadDraft, saveDraft } from "@/lib/onboarding/draft"
import {
  FREQUENCIES,
  INSTRUMENTS,
  MAX_PROPOSED_CENTRES,
  ONBOARDING_STEPS,
  SAMPLE_TYPES,
  STEP,
  USER_TIERS,
  validateStep,
  type FieldErrors,
  type OnboardingValues,
} from "@/lib/onboarding/schema"
import { DEFAULT_COUNTS, countsFit, presetLayout, samplesPerPlate } from "@/lib/plate/layout"
import { defaultRuleSettings } from "@/lib/rules/catalog"
import { cn } from "@/lib/utils"

/**
 * Fills in the plate layout and rules from the kit when they are missing or were
 * made for a different layout orientation or for several samples per plate
 * (e.g. a restored draft; samples per plate are now chosen on each upload).
 */
function withKitDefaults(values: OnboardingValues, kit: KitSummary | null): OnboardingValues {
  if (!kit) return values
  const next = { ...values }
  const current = next.plateLayout
  if (!current || current.orientation !== kit.orientation || samplesPerPlate(current.counts) > 1) {
    const counts = current ? { unknownReplicates: current.counts.unknownReplicates, pc: current.counts.pc, nc: current.counts.nc } : DEFAULT_COUNTS
    next.plateLayout = presetLayout(kit, countsFit(kit, counts) ? counts : DEFAULT_COUNTS)
  }
  if (Object.keys(next.qcRules).length === 0) next.qcRules = defaultRuleSettings(kit, "qc")
  if (Object.keys(next.compileRules).length === 0) next.compileRules = defaultRuleSettings(kit, "compile")
  return next
}

type StringKey = {
  [K in keyof OnboardingValues]: OnboardingValues[K] extends string ? K : never
}[keyof OnboardingValues]
type BooleanKey = {
  [K in keyof OnboardingValues]: OnboardingValues[K] extends boolean ? K : never
}[keyof OnboardingValues]

const inputClass =
  "h-10 w-full rounded-md border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive"

export function OnboardingForm({ kits }: { kits: KitSummary[] }) {
  const router = useRouter()
  const [initial] = useState(loadDraft)
  const [values, setValues] = useState<OnboardingValues>(() =>
    withKitDefaults(initial.values, kits.find((k) => k.id === initial.values.kitId) ?? null)
  )
  const [step, setStep] = useState(initial.step)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [website, setWebsite] = useState("")
  const [checkingCode, setCheckingCode] = useState(false)
  const [submitting, startSubmit] = useTransition()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const passwordNotice = initial.step > 0 && !values.password

  useEffect(() => {
    saveDraft({ step, values })
  }, [step, values])

  const kit = kits.find((k) => k.id === values.kitId) ?? null
  const current = ONBOARDING_STEPS[step]
  const isLast = step === ONBOARDING_STEPS.length - 1
  const progress = Math.round(((step + 1) / ONBOARDING_STEPS.length) * 100)

  function clearError(key: string) {
    setErrors((e) => {
      if (!(key in e)) return e
      const next = { ...e }
      delete next[key]
      return next
    })
  }

  function set<K extends keyof OnboardingValues>(key: K, value: OnboardingValues[K]) {
    setValues((v) => ({ ...v, [key]: value }))
    clearError(key)
  }

  function showErrors(next: FieldErrors) {
    setErrors(next)
    const first = Object.keys(next)[0]
    if (first) requestAnimationFrame(() => document.getElementById(first)?.focus())
  }

  function goTo(nextStep: number) {
    setStep(nextStep)
    setFormError(null)
    window.scrollTo({ top: 0 })
    requestAnimationFrame(() => headingRef.current?.focus())
  }

  function selectKit(kitId: string) {
    // A new kit has different tubes and controls, so the layout and rules start again.
    setValues((v) => ({ ...v, kitId, plateLayout: null, qcRules: {}, compileRules: {} }))
    clearError("kitId")
  }

  async function next() {
    const result = validateStep(step, values, kit)
    if (!result.ok) return showErrors(result.errors)
    if (step === STEP.project) {
      setCheckingCode(true)
      try {
        const check = await checkShortCodeAction(values.shortCode)
        if (!check.available) {
          return showErrors({ shortCode: check.message ?? "This short code is not available." })
        }
      } catch {
        return showErrors({ shortCode: "Could not check the short code. Try again." })
      } finally {
        setCheckingCode(false)
      }
    }
    setErrors({})
    if (step === STEP.qpcr) setValues((v) => withKitDefaults(v, kit))
    goTo(step + 1)
  }

  function submit() {
    const result = validateStep(step, values, kit)
    if (!result.ok) return showErrors(result.errors)
    startSubmit(async () => {
      try {
        const outcome = await submitOnboardingAction({ values, website })
        if (outcome.ok) {
          clearDraft()
          router.replace(`/onboarding/received?ref=${encodeURIComponent(outcome.reference)}`)
          return
        }
        setFormError(outcome.message)
        if (outcome.step !== undefined && outcome.step !== step) goTo(outcome.step)
        showErrors(outcome.errors ?? {})
      } catch {
        setFormError("Something went wrong. Please try again.")
      }
    })
  }

  const field = (key: StringKey) => ({
    id: key,
    name: key,
    value: values[key],
    "aria-invalid": errors[key] ? true : undefined,
    "aria-describedby": errors[key] ? `${key}-error` : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      set(key, e.target.value),
  })

  return (
    <form
      noValidate
      className="mt-8"
      onSubmit={(e) => {
        e.preventDefault()
        if (isLast) submit()
        else void next()
      }}
    >
      <div>
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium">
            Step {step + 1} of {ONBOARDING_STEPS.length}
          </span>
          <span className="text-muted-foreground">{current.title}</span>
        </div>
        <div
          role="progressbar"
          aria-label="Form progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
        </div>
        <ol className="mt-3 hidden gap-2 text-xs text-muted-foreground md:flex">
          {ONBOARDING_STEPS.map((s, i) => (
            <li key={s.title} className={cn("flex-1", i === step && "font-medium text-foreground")}>
              {i + 1}. {s.title}
            </li>
          ))}
        </ol>
      </div>

      {/* Honeypot: hidden from people and assistive tech; bots tend to fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="website">Website</label>
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <section className="mt-8 rounded-lg border bg-card p-5 md:p-6">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
          {current.title}
        </h2>

        {passwordNotice && step === STEP.account ? (
          <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            We restored your saved progress. For security your password is never saved, so please
            enter it again.
          </p>
        ) : null}

        <div className="mt-5 grid gap-5 md:grid-cols-2">
          {step === STEP.account ? (
            <>
              <Field label="Full name" error={errors.fullName} htmlFor="fullName">
                <input {...field("fullName")} autoComplete="name" className={inputClass} />
              </Field>
              <Field label="Designation" error={errors.designation} htmlFor="designation">
                <input {...field("designation")} autoComplete="organization-title" className={inputClass} />
              </Field>
              <Field label="Email" hint="This will be your login." error={errors.email} htmlFor="email">
                <input {...field("email")} type="email" autoComplete="email" className={inputClass} />
              </Field>
              <Field label="Phone" error={errors.phone} htmlFor="phone">
                <input {...field("phone")} type="tel" autoComplete="tel" className={inputClass} />
              </Field>
              <Field label="Password" hint="At least 10 characters." error={errors.password} htmlFor="password">
                <input {...field("password")} type="password" autoComplete="new-password" className={inputClass} />
              </Field>
              <Field label="Confirm password" error={errors.confirmPassword} htmlFor="confirmPassword">
                <input
                  {...field("confirmPassword")}
                  type="password"
                  autoComplete="new-password"
                  className={inputClass}
                />
              </Field>
            </>
          ) : null}

          {step === STEP.organisation ? (
            <>
              <Field
                label="Nodal lab or institute name"
                error={errors.institutionName}
                htmlFor="institutionName"
                wide
              >
                <input {...field("institutionName")} autoComplete="organization" className={inputClass} />
              </Field>
              <Field label="City" error={errors.city} htmlFor="city">
                <input {...field("city")} autoComplete="address-level2" className={inputClass} />
              </Field>
              <Field label="State" error={errors.state} htmlFor="state">
                <input {...field("state")} autoComplete="address-level1" className={inputClass} />
              </Field>
            </>
          ) : null}

          {step === STEP.project ? (
            <>
              <Field label="Project title" error={errors.projectTitle} htmlFor="projectTitle" wide>
                <input {...field("projectTitle")} className={inputClass} />
              </Field>
              <Field
                label="Short code"
                hint="For example RBL-AMR. Used in links and file names, and must be unique."
                error={errors.shortCode}
                htmlFor="shortCode"
              >
                <input
                  {...field("shortCode")}
                  onChange={(e) => set("shortCode", e.target.value.toUpperCase())}
                  autoCapitalize="characters"
                  spellCheck={false}
                  className={cn(inputClass, "font-mono uppercase")}
                />
              </Field>
              <Field label="Funding agency" optional error={errors.fundingAgency} htmlFor="fundingAgency">
                <input {...field("fundingAgency")} className={inputClass} />
              </Field>
              <Field label="Objective" hint="One paragraph." error={errors.objective} htmlFor="objective" wide>
                <textarea {...field("objective")} rows={5} className={cn(inputClass, "h-auto py-2")} />
              </Field>
              <Field label="Start date" optional error={errors.startDate} htmlFor="startDate">
                <input {...field("startDate")} type="date" className={inputClass} />
              </Field>
              <Field label="End date" optional error={errors.endDate} htmlFor="endDate">
                <input {...field("endDate")} type="date" min={values.startDate || undefined} className={inputClass} />
              </Field>
              <Field label="Sample type" error={errors.sampleType} htmlFor="sampleType">
                <Select {...field("sampleType")} options={SAMPLE_TYPES} />
              </Field>
              {values.sampleType === "other" ? (
                <Field label="Describe the sample type" error={errors.sampleTypeOther} htmlFor="sampleTypeOther">
                  <input {...field("sampleTypeOther")} className={inputClass} />
                </Field>
              ) : null}
              <Field label="Sampling frequency" error={errors.frequency} htmlFor="frequency">
                <Select {...field("frequency")} options={FREQUENCIES} />
              </Field>
              <Field
                label="Ethics approval reference"
                optional
                error={errors.ethicsReference}
                htmlFor="ethicsReference"
              >
                <input {...field("ethicsReference")} className={inputClass} />
              </Field>
            </>
          ) : null}

          {step === STEP.qpcr ? (
            <>
              <Field label="Multiplex kit" error={errors.kitId} htmlFor="kitId" wide>
                {kits.length > 0 ? (
                  <Select
                    {...field("kitId")}
                    onChange={(e) => selectKit(e.target.value)}
                    options={kits.map((k) => ({ value: k.id, label: k.name }))}
                  />
                ) : (
                  <p id="kitId" tabIndex={-1} className="text-sm text-destructive">
                    Kits could not be loaded. Please refresh the page or try again later.
                  </p>
                )}
              </Field>
              {kit ? (
                <div className="space-y-2 md:col-span-2">
                  <p className="text-sm">
                    <span className="font-medium">Targets and fluorophores.</span>{" "}
                    <span className="text-muted-foreground">
                      Centres must use exactly these target names and fluorophores when setting up the plate in the
                      qPCR software, so their files can be checked and compiled.
                    </span>
                  </p>
                  <KitPanelTable tubes={kit.tubes} caption={`Targets in ${kit.name}`} />
                </div>
              ) : null}
              <fieldset className="space-y-1.5 md:col-span-2">
                <legend className="text-sm font-medium">qPCR instruments</legend>
                <p className="text-xs text-muted-foreground">
                  Choose every instrument your centres use. Export formats differ between instruments.
                </p>
                <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
                  {INSTRUMENTS.map((o, i) => (
                    <Checkbox
                      key={o.value}
                      id={i === 0 ? "instruments" : `instruments-${o.value}`}
                      label={o.label}
                      checked={values.instruments.includes(o.value)}
                      invalid={!!errors.instruments}
                      onChange={(checked) =>
                        set(
                          "instruments",
                          checked
                            ? [...values.instruments, o.value]
                            : values.instruments.filter((v) => v !== o.value)
                        )
                      }
                    />
                  ))}
                </div>
                <FieldError id="instruments" message={errors.instruments} />
              </fieldset>
              {values.instruments.includes("other") ? (
                <Field label="Other instrument name" error={errors.instrumentOther} htmlFor="instrumentOther">
                  <input {...field("instrumentOther")} className={inputClass} />
                </Field>
              ) : null}
              <Field label="Number of users" error={errors.userTier} htmlFor="userTier">
                <Select {...field("userTier")} options={USER_TIERS} />
              </Field>
              <CentreTable
                rows={values.centres}
                errors={errors}
                onChange={(rows) => set("centres", rows)}
              />
            </>
          ) : null}

          {step === STEP.layout ? (
            kit && values.plateLayout ? (
              <PlateLayoutStep
                key={kit.id}
                kit={kit}
                layout={values.plateLayout}
                error={errors.plateLayout}
                onChange={(layout) => set("plateLayout", layout)}
              />
            ) : (
              <p id="plateLayout" tabIndex={-1} className="text-sm text-destructive md:col-span-2">
                Choose a kit in the qPCR setup step first.
              </p>
            )
          ) : null}

          {step === STEP.rules ? (
            kit ? (
              <RulesStep
                kit={kit}
                qcRules={values.qcRules}
                compileRules={values.compileRules}
                errors={errors}
                onChange={(key, settings, clearKey) => {
                  setValues((v) => ({ ...v, [key]: settings }))
                  if (clearKey) clearError(clearKey)
                }}
              />
            ) : (
              <p className="text-sm text-destructive md:col-span-2">Choose a kit in the qPCR setup step first.</p>
            )
          ) : null}

          {step === STEP.analysis ? (
            <>
              <fieldset className="md:col-span-2">
                <legend className="text-sm font-medium">Analysis required</legend>
                <div className="mt-2 space-y-2">
                  {(
                    [
                      ["dataManagement", "Data management"],
                      ["dataCompilation", "Data compilation"],
                      ["dataPlotting", "Data plotting"],
                    ] as [BooleanKey, string][]
                  ).map(([key, label]) => (
                    <Checkbox
                      key={key}
                      id={key}
                      label={label}
                      checked={values[key]}
                      invalid={key === "dataManagement" && !!errors.dataManagement}
                      onChange={(checked) => {
                        set(key, checked)
                        // The "choose at least one" error is reported on dataManagement.
                        if (checked) clearError("dataManagement")
                      }}
                    />
                  ))}
                </div>
                <FieldError id="dataManagement" message={errors.dataManagement} />
              </fieldset>
              <div className="md:col-span-2">
                <Checkbox
                  id="consent"
                  label="I agree to the QSurv terms of use and consent to the project's data being stored and shared with the QSurv team for surveillance purposes."
                  checked={values.consent}
                  invalid={!!errors.consent}
                  onChange={(checked) => set("consent", checked)}
                />
                <FieldError id="consent" message={errors.consent} />
              </div>
            </>
          ) : null}
        </div>
      </section>

      {formError ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {formError}
        </p>
      ) : null}

      <div className="mt-6 flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={step === 0 || submitting}
          onClick={() => goTo(step - 1)}
        >
          Back
        </Button>
        <Button type="submit" disabled={submitting || checkingCode}>
          {isLast
            ? submitting
              ? "Submitting..."
              : "Submit request"
            : checkingCode
              ? "Checking..."
              : "Next"}
        </Button>
      </div>
    </form>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  wide,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  error?: string
  optional?: boolean
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={cn("space-y-1.5", wide && "md:col-span-2")}>
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
        {optional ? <span className="font-normal text-muted-foreground"> (optional)</span> : null}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <FieldError id={htmlFor} message={error} />
    </div>
  )
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={`${id}-error`} className="text-xs text-destructive">
      {message}
    </p>
  )
}

function Select({
  options,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  options: readonly { value: string; label: string }[]
}) {
  return (
    <select {...props} className={inputClass}>
      <option value="">Select...</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function Checkbox({
  id,
  label,
  checked,
  invalid,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  invalid?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label htmlFor={id} className="flex items-start gap-2 text-sm">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 accent-primary"
      />
      <span>{label}</span>
    </label>
  )
}

function CentreTable({
  rows,
  errors,
  onChange,
}: {
  rows: OnboardingValues["centres"]
  errors: FieldErrors
  onChange: (rows: OnboardingValues["centres"]) => void
}) {
  const update = (index: number, key: keyof OnboardingValues["centres"][number], value: string) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)))

  return (
    <div className="md:col-span-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">
          Centres <span className="font-normal text-muted-foreground">(optional)</span>
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={rows.length >= MAX_PROPOSED_CENTRES}
          onClick={() => onChange([...rows, { name: "", city: "", contactEmail: "" }])}
        >
          <Plus aria-hidden /> Add centre
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        List the centres you already know. You can add the rest after approval. Each centre&apos;s name and city
        become its code in upload file names (Centre ID_Name_City_DDMMYY), so they stay fixed once it uploads.
      </p>
      <FieldError id="centres" message={errors.centres} />
      {rows.length > 0 ? (
        <div className="mt-3 space-y-3">
          {rows.map((row, i) => (
            <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-start">
              {(
                [
                  ["name", "Centre name", "text"],
                  ["city", "City", "text"],
                  ["contactEmail", "Contact email", "email"],
                ] as const
              ).map(([key, label, type]) => {
                const id = `centres.${i}.${key}`
                return (
                  <div key={key} className="space-y-1">
                    <label htmlFor={id} className="text-xs text-muted-foreground">
                      {label}
                    </label>
                    <input
                      id={id}
                      type={type}
                      value={row[key]}
                      aria-invalid={errors[id] ? true : undefined}
                      aria-describedby={errors[id] ? `${id}-error` : undefined}
                      onChange={(e) => update(i, key, e.target.value)}
                      className={inputClass}
                    />
                    <FieldError id={id} message={errors[id]} />
                  </div>
                )
              })}
              {row.name.trim() && row.city.trim() ? (
                <p className="text-xs text-muted-foreground sm:col-span-3">
                  File names: <span className="font-mono">C01_{centreFileCode(row.name, row.city)}_DDMMYY.csv</span>{" "}
                  (C01 stands for the centre ID you give it when adding its users)
                </p>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove centre ${i + 1}`}
                className="sm:mt-5"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
