import type { ActionState } from "@/lib/project-admin/result"
import { cn } from "@/lib/utils"

export const inputClass =
  "h-10 w-full rounded-md border bg-background px-3 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"

export const textareaClass =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"

export function Field({
  id,
  label,
  hint,
  className,
  children,
}: {
  id: string
  label: string
  hint?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {hint ? <span className="ml-1 font-normal text-muted-foreground">{hint}</span> : null}
      </label>
      {children}
    </div>
  )
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state.message) return null
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={cn("text-sm", state.status === "error" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}
    >
      {state.message}
    </p>
  )
}

export function Panel({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border bg-card">
      <div className="border-b px-4 py-3">
        <h3 className="font-semibold">{title}</h3>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}
