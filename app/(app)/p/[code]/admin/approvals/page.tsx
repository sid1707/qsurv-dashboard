import { ApprovalQueue } from "@/components/project-admin/approval-queue"
import { listApprovalQueue } from "@/lib/project-admin/approvals"
import { requireProjectAdmin } from "@/lib/projects/context"
import { ADMIN_PAGES } from "@/lib/projects/features"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export default async function ApprovalsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const { project, features } = await requireProjectAdmin(code, { pages: ADMIN_PAGES, page: "approvals" })
  const items = await listApprovalQueue(await createClient(), project.id)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Approvals</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Uploads that passed validation, oldest first.{" "}
          {features.data_compilation
            ? "Approving compiles the run into the project's compiled data using the kit's targets and the project's compilation rules."
            : "Approving accepts the upload; data compilation is not switched on for this project."}{" "}
          Rejected uploads go back to the centre with your reason.
        </p>
      </div>
      <ApprovalQueue code={project.code} items={items} compiles={features.data_compilation} />
    </div>
  )
}
