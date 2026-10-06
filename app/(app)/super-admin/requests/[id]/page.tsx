import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { KitPanelTable } from "@/components/plate/kit-panel"
import { LayoutPreview } from "@/components/plate/layout-preview"
import { RulesSummary } from "@/components/plate/rules-summary"
import { ReviewActions } from "@/components/super-admin/review-actions"
import { formatDateFromDb, formatDateTimeIso } from "@/lib/format"
import { frequencyLabel, instrumentsLabel, sampleTypeLabel, userTierLabel } from "@/lib/onboarding/labels"
import { getRequest } from "@/lib/super-admin/requests"
import { createClient } from "@/lib/supabase/server"

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-5">
      <h2 className="font-semibold">{title}</h2>
      <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">{children}</dl>
    </section>
  )
}

function Item({ label, value, wide }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words whitespace-pre-line">{value || "—"}</dd>
    </div>
  )
}

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const request = await getRequest(await createClient(), id)
  if (!request) notFound()

  const features = [
    request.data_management && "Data management",
    request.data_compilation && "Data compilation",
    request.data_plotting && "Data plotting",
  ].filter(Boolean) as string[]
  const centres = request.proposed_centres.filter((c) => c.name?.trim())

  return (
    <div className="space-y-6">
      <div>
        <Link href="/super-admin" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> All requests
        </Link>
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">{request.project_title}</h2>
          <span className="font-mono text-sm text-muted-foreground">{request.reference}</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Submitted {formatDateTimeIso(request.created_at)} · <span className="capitalize">{request.status}</span>
        </p>
      </div>

      {request.status !== "pending" ? (
        <div className="rounded-lg border bg-muted/40 p-4 text-sm">
          <p>
            <span className="font-medium capitalize">{request.status}</span> on{" "}
            {formatDateTimeIso(request.reviewed_at)}.
          </p>
          {request.review_note ? (
            <p className="mt-1 whitespace-pre-line">
              {request.status === "rejected" ? "Reason: " : "Note: "}
              {request.review_note}
            </p>
          ) : null}
        </div>
      ) : null}

      <Section title="1. Admin account">
        <Item label="Full name" value={request.requester_name} />
        <Item label="Designation" value={request.requester_designation} />
        <Item label="Email (login)" value={request.requester_email} />
        <Item label="Phone" value={request.requester_phone} />
      </Section>

      <Section title="2. Organisation">
        <Item label="Nodal lab or institute" value={request.institution_name} wide />
        <Item label="City" value={request.city} />
        <Item label="State" value={request.state} />
      </Section>

      <Section title="3. Project">
        <Item label="Project title" value={request.project_title} wide />
        <Item label="Short code" value={<span className="font-mono">{request.requested_code}</span>} />
        <Item label="Funding agency" value={request.funding_agency} />
        <Item label="Objective" value={request.objective} wide />
        <Item label="Start date" value={formatDateFromDb(request.start_date)} />
        <Item label="End date" value={formatDateFromDb(request.end_date)} />
        <Item label="Sample type" value={sampleTypeLabel(request.sample_type, request.sample_type_other)} />
        <Item label="Sampling frequency" value={frequencyLabel(request.frequency)} />
        <Item label="Ethics approval reference" value={request.ethics_reference} />
      </Section>

      <Section title="4. qPCR setup">
        <Item label="Multiplex kit" value={request.kit ? `${request.kit.name} (${request.kit.version})` : null} />
        <Item
          label="qPCR instruments"
          value={instrumentsLabel(request.instruments, request.instrument_other, request.instrument)}
        />
        {request.expected_centre_count ? (
          <Item label="Number of centres" value={request.expected_centre_count} />
        ) : null}
        <Item label="Number of users" value={userTierLabel(request.user_tier)} />
        {request.kit && request.kit.tubes.length > 0 ? (
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Targets and fluorophores</dt>
            <dd className="mt-1">
              <KitPanelTable tubes={request.kit.tubes} caption={`Targets in ${request.kit.name}`} />
            </dd>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground">Centres listed ({centres.length})</dt>
          <dd className="mt-1">
            {centres.length === 0 ? (
              "None listed. Centres can be added after approval."
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-4 font-normal">Name</th>
                      <th className="py-1 pr-4 font-normal">City</th>
                      <th className="py-1 font-normal">Contact email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {centres.map((c, i) => (
                      <tr key={i} className="border-t">
                        <td className="py-1.5 pr-4">{c.name}</td>
                        <td className="py-1.5 pr-4">{c.city || "—"}</td>
                        <td className="py-1.5">{c.contact_email || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </dd>
        </div>
      </Section>

      <section className="rounded-lg border bg-card p-5">
        <h2 className="font-semibold">5. Plate layout</h2>
        {request.plate_layout && request.kit ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              {request.plate_layout.counts.unknownReplicates} unknown replicate
              {request.plate_layout.counts.unknownReplicates === 1 ? "" : "s"}, {request.plate_layout.counts.pc}{" "}
              positive and {request.plate_layout.counts.nc} negative control
              {request.plate_layout.counts.nc === 1 ? "" : "s"} per tube.
            </p>
            <LayoutPreview tubes={request.kit.tubes} layout={request.plate_layout} />
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Not recorded (submitted before plate layouts were added).</p>
        )}
      </section>

      <section className="rounded-lg border bg-card p-5">
        <h2 className="font-semibold">6. Data rules</h2>
        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          <RulesSummary title="Quality checks" settings={request.qc_rules} />
          <RulesSummary title="Compilation" settings={request.compile_rules} />
        </div>
      </section>

      <Section title="7. Analysis">
        <Item label="Analysis required" value={features.join(", ")} wide />
        <Item
          label="Terms and data-sharing consent"
          value={request.consent_accepted_at ? `Accepted ${formatDateTimeIso(request.consent_accepted_at)}` : "Not recorded"}
          wide
        />
      </Section>

      {request.status === "pending" ? (
        <ReviewActions
          requestId={request.id}
          projectCode={request.requested_code}
          // Approval merges centres with the same name, so count distinct names.
          centreCount={new Set(centres.map((c) => c.name.trim().toLowerCase())).size}
        />
      ) : null}
    </div>
  )
}
