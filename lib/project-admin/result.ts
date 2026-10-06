import type { SupabaseClient } from "@supabase/supabase-js"

/** What every project admin action returns to its form. */
export type ActionState = { status: "idle" | "success" | "error"; message?: string }
export const IDLE: ActionState = { status: "idle" }

export const ok = (message: string): ActionState => ({ status: "success", message })
export const fail = (message: string): ActionState => ({ status: "error", message })

type DbError = { code?: string; message: string }

/**
 * Turns a Postgres or PostgREST error into a message for the project admin.
 * Messages raised on purpose by our functions and triggers (P0001, 22023) are
 * already written for people, so they pass through.
 */
export function dbErrorMessage(error: DbError, duplicate = "That already exists.") {
  switch (error.code) {
    case "23505":
      return duplicate
    case "42501":
      return "You do not have permission to do this."
    case "P0001":
    case "P0002":
    case "22023":
      return error.message
    default:
      return `Could not save: ${error.message}`
  }
}

/**
 * Records what a project admin did. The audit trail is a record, not a gate,
 * so a failure here is logged and the action still succeeds.
 */
export async function recordAudit(
  supabase: SupabaseClient,
  event: {
    projectId: string
    actorId: string
    actorRole: string
    eventType: string
    entityType: string
    entityId: string
    payload?: Record<string, unknown>
  }
) {
  const { error } = await supabase.from("audit_events").insert({
    project_id: event.projectId,
    actor_user_id: event.actorId,
    actor_role: event.actorRole,
    event_type: event.eventType,
    entity_type: event.entityType,
    entity_id: event.entityId,
    payload: event.payload ?? {},
  })
  if (error) console.error(`Audit event ${event.eventType} was not recorded: ${error.message}`)
}
