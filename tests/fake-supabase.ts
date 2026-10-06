import type { SupabaseClient } from "@supabase/supabase-js"
import { vi } from "vitest"

type Result = { data?: unknown; error?: { code?: string; message: string } | null; count?: number | null }
type Call = { table: string; op: string; args: unknown[]; filters: [string, unknown][] }

/**
 * A stand-in for the PostgREST query builder. Every builder method chains;
 * awaiting the builder (or calling single/maybeSingle) resolves to the result
 * the test registered for that table and operation ("select", "insert",
 * "update", "delete"). Calls are recorded for assertions.
 */
export function fakeSupabase(
  results: Record<string, Result | ((call: Call) => Result)> = {},
  /** Storage objects by "<bucket>/<path>", for storage.from(bucket).download(path). */
  files: Record<string, string> = {}
) {
  const calls: Call[] = []
  const rpc = vi.fn(async (...args: [name: string, params?: unknown]): Promise<Result> => {
    void args
    return { data: null, error: null }
  })

  function builder(table: string) {
    const call: Call = { table, op: "select", args: [], filters: [] }
    calls.push(call)
    const resolve = () => {
      const entry = results[`${table}.${call.op}`]
      const result = typeof entry === "function" ? entry(call) : entry
      return { data: null, error: null, count: null, ...result }
    }
    const chain: Record<string, unknown> = {}
    for (const op of ["insert", "update", "delete", "upsert"]) {
      chain[op] = (...args: unknown[]) => {
        call.op = op
        call.args = args
        return chain
      }
    }
    chain.select = (...args: unknown[]) => {
      if (call.op === "select") call.args = args
      return chain
    }
    for (const f of ["eq", "neq", "in", "is", "order", "limit", "gte", "lte", "range"]) {
      chain[f] = (column: string, value: unknown) => {
        call.filters.push([`${f}:${column}`, value])
        return chain
      }
    }
    chain.single = async () => resolve()
    chain.maybeSingle = async () => resolve()
    chain.then = (onFulfilled: (r: Result) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onFulfilled, onRejected)
    return chain
  }

  const storage = {
    from: (bucket: string) => ({
      download: async (path: string) => {
        const text = files[`${bucket}/${path}`]
        return text === undefined
          ? { data: null, error: { message: "Object not found" } }
          : { data: new Blob([text], { type: "text/csv" }), error: null }
      },
    }),
  }
  const client = { from: vi.fn(builder), rpc, storage } as unknown as SupabaseClient
  return { client, calls, rpc }
}
