import { CheckCircle2, Circle, Clock, Loader2, XCircle } from "lucide-react"
import { uploadStatus, type UploadBatchStatus, type UploadStatusTone } from "@/lib/upload/status"
import { cn } from "@/lib/utils"

const ICONS: Record<UploadStatusTone, typeof Circle> = {
  neutral: Circle,
  progress: Loader2,
  waiting: Clock,
  good: CheckCircle2,
  bad: XCircle,
}

const TONE_CLASS: Record<UploadStatusTone, string> = {
  neutral: "text-muted-foreground",
  progress: "text-foreground",
  waiting: "text-foreground",
  good: "text-emerald-700 dark:text-emerald-400",
  bad: "text-destructive",
}

/** Icon plus label, so the state never rests on colour alone. */
export function UploadStatusBadge({ batch }: { batch: UploadBatchStatus }) {
  const { label, tone } = uploadStatus(batch)
  const Icon = ICONS[tone]
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", TONE_CLASS[tone])}>
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  )
}
