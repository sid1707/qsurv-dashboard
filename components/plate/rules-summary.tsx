import { RULES_BY_ID, type RuleSettings } from "@/lib/rules/catalog"

/** Read-only list of the rules a request or project uses, with their parameters. */
export function RulesSummary({ title, settings }: { title: string; settings: RuleSettings | null }) {
  const entries = Object.entries(settings ?? {})
  return (
    <div>
      <h3 className="text-sm font-medium">{title}</h3>
      {entries.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">None recorded.</p>
      ) : (
        <ul className="mt-1 space-y-1 text-sm">
          {entries.map(([id, setting]) => {
            const rule = RULES_BY_ID.get(id)
            const params = [
              ...(rule?.params ?? []).map((p) => `${p.label}: ${setting.params?.[p.key] ?? p.default}`),
              ...(rule?.choices ?? []).map((c) => {
                const value = setting.choices?.[c.key] ?? c.default
                return `${c.label}: ${c.options.find((o) => o.value === value)?.label ?? value}`
              }),
            ].join(", ")
            return (
              <li key={id} className={setting.enabled ? "" : "text-muted-foreground line-through"}>
                {rule?.label ?? id}
                {setting.enabled && params ? <span className="text-muted-foreground"> — {params}</span> : null}
                {!setting.enabled ? <span className="sr-only"> (off)</span> : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
