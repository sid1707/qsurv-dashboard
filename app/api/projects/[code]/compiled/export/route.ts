import { compiledToCsv, fetchAllCompiled, listProjectCentres, parseCompiledFilters } from "@/lib/project-admin/compiled"
import { requireProjectAdminApi } from "@/lib/project-admin/api-auth"
import { createClient } from "@/lib/supabase/server"

/** CSV of the compiled data with the page's filters (centre, date range, target). */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const auth = await requireProjectAdminApi(code, "data_compilation")
  if (!auth.ok) return auth.response
  const { project } = auth.context

  const filters = parseCompiledFilters(new URL(request.url).searchParams)
  const supabase = await createClient()
  try {
    const [rows, centres] = await Promise.all([fetchAllCompiled(supabase, project.id, filters), listProjectCentres(supabase, project.id)])
    const stamp = new Date().toISOString().slice(0, 10)
    // The BOM makes Excel read the file as UTF-8.
    return new Response(`﻿${compiledToCsv(rows, centres)}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${project.code}_compiled_${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    return Response.json({ message: (error as Error).message }, { status: 500 })
  }
}
