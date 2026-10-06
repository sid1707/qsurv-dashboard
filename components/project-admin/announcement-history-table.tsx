"use client"

// Adapted from vrdl-next-platform components/admin/announcement-history-table.tsx.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { setAnnouncementArchivedAction } from "@/app/(app)/p/[code]/admin/actions"
import { Button } from "@/components/ui/button"
import type { AdminAnnouncementRow } from "@/lib/announcements/queries"
import { formatDateTimeIso } from "@/lib/format"
import { cn } from "@/lib/utils"

type BusyAction = { id: string; action: "archive" | "restore" }

function audienceSummary(row: AdminAnnouncementRow): string {
  if (row.audience === "all_centres") return "All centres"
  if (row.centreNames.length === 0) return "Selected centres (none)"
  if (row.centreNames.length <= 3) return row.centreNames.join(", ")
  return `${row.centreNames.slice(0, 3).join(", ")} +${row.centreNames.length - 3}`
}

export function AnnouncementHistoryTable({ code, rows }: { code: string; rows: AdminAnnouncementRow[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<BusyAction | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function handleAction(id: string, action: "archive" | "restore") {
    setBusy({ id, action })
    setMessage(null)
    try {
      const result = await setAnnouncementArchivedAction(code, id, action === "archive")
      setMessage(result.message ?? null)
      if (result.status === "success") router.refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${action} failed`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      {message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th scope="col" className="px-3 py-2 font-medium">Title</th>
              <th scope="col" className="px-3 py-2 font-medium">Audience</th>
              <th scope="col" className="px-3 py-2 font-medium">Created</th>
              <th scope="col" className="px-3 py-2 font-medium">Status</th>
              <th scope="col" className="px-3 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  No announcements yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const archived = Boolean(row.archivedAt)
                const isBusy = busy?.id === row.id
                return (
                  <tr key={row.id} className={cn("border-b last:border-0", archived && "text-muted-foreground")}>
                    <td className="px-3 py-2 align-top">
                      <p className="font-medium text-foreground">{row.title}</p>
                      <p className="mt-1 line-clamp-2 max-w-sm text-xs text-muted-foreground">{row.body}</p>
                    </td>
                    <td className="px-3 py-2 align-top">{audienceSummary(row)}</td>
                    <td className="px-3 py-2 align-top whitespace-nowrap">{formatDateTimeIso(row.createdAt)}</td>
                    <td className="px-3 py-2 align-top">{archived ? "Archived" : "Live"}</td>
                    <td className="px-3 py-2 align-top">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isBusy}
                        onClick={() => void handleAction(row.id, archived ? "restore" : "archive")}
                      >
                        {archived
                          ? isBusy ? "Restoring..." : "Restore"
                          : isBusy ? "Archiving..." : "Archive"}
                      </Button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
