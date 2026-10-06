import Image from "next/image"
import { cn } from "@/lib/utils"

// Intrinsic size of public/qsurv-logo.png, used for the aspect ratio.
const LOGO_WIDTH = 1379
const LOGO_HEIGHT = 1229

export function QSurvLogo({
  size = 32,
  withWordmark = true,
  className,
  priority,
}: {
  size?: number
  withWordmark?: boolean
  className?: string
  priority?: boolean
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Image
        src="/qsurv-logo.png"
        alt={withWordmark ? "" : "QSurv"}
        width={size}
        height={Math.round((size * LOGO_HEIGHT) / LOGO_WIDTH)}
        priority={priority}
      />
      {withWordmark ? <span className="text-lg font-semibold tracking-tight">QSurv</span> : null}
    </span>
  )
}
