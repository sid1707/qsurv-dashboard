import type { Metadata } from "next"
import Link from "next/link"
import { CheckCircle2 } from "lucide-react"
import { QSurvLogo } from "@/components/brand/logo"
import { buttonVariants } from "@/components/ui/button"

export const metadata: Metadata = {
  title: "Request received · QSurv",
}

const REFERENCE_PATTERN = /^QS-[0-9A-F]{8}$/

export default async function RequestReceivedPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string | string[] }>
}) {
  const { ref } = await searchParams
  const reference = typeof ref === "string" && REFERENCE_PATTERN.test(ref) ? ref : null

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-3xl items-center px-4 py-3 md:px-6">
          <Link href="/" aria-label="QSurv home">
            <QSurvLogo size={28} />
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-16 md:px-6">
        <CheckCircle2 className="size-10 text-emerald-600" aria-hidden />
        <h1 className="mt-4 text-2xl font-semibold">Request received</h1>
        {reference ? (
          <div className="mt-6 rounded-lg border bg-card p-5">
            <p className="text-sm text-muted-foreground">Your request reference</p>
            <p className="mt-1 font-mono text-2xl font-semibold tracking-wider">{reference}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Keep this reference if you need to contact the QSurv team about your request.
            </p>
          </div>
        ) : null}
        <div className="mt-6 space-y-3 text-muted-foreground">
          <p>
            Your admin account has been created, but it stays locked until the QSurv team approves
            your project.
          </p>
          <p>Once approved, sign in with the email and password you chose.</p>
        </div>
        <Link href="/" className={buttonVariants({ variant: "outline", className: "mt-8" })}>
          Back to home
        </Link>
      </main>
    </div>
  )
}
