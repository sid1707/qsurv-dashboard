"use client"

import { useId, useState } from "react"
import { enIN } from "date-fns/locale"
import { CalendarIcon } from "lucide-react"
import {
  formatDmySlashFromYmd,
  localDateToYmd,
  parseDmySlashToYmd,
  ymdToLocalDate,
} from "@/lib/dashboard/date-input"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export type DmyDateInputProps = {
  name: string
  /** Id for the visible text field, so a <label htmlFor> can point at it. */
  id?: string
  defaultYmd?: string
  required?: boolean
  disabled?: boolean
  className?: string
}

export function DmyDateInput({ name, id, defaultYmd, required, disabled, className }: DmyDateInputProps) {
  const hintId = useId()
  const [open, setOpen] = useState(false)
  const [ymd, setYmd] = useState(defaultYmd ?? "")
  const [display, setDisplay] = useState(() => (defaultYmd ? formatDmySlashFromYmd(defaultYmd) : ""))
  const [invalid, setInvalid] = useState(false)
  const [prevDefaultYmd, setPrevDefaultYmd] = useState(defaultYmd)

  // Re-sync when the parent passes a new default (adjusting state during render).
  if (defaultYmd !== prevDefaultYmd) {
    setPrevDefaultYmd(defaultYmd)
    if (defaultYmd) {
      setYmd(defaultYmd)
      setDisplay(formatDmySlashFromYmd(defaultYmd))
      setInvalid(false)
    }
  }

  const selectedDate = ymd ? ymdToLocalDate(ymd) : undefined

  function applyYmd(iso: string) {
    setYmd(iso)
    setDisplay(formatDmySlashFromYmd(iso))
    setInvalid(false)
  }

  function commitDisplay(raw: string) {
    const trimmed = raw.trim()
    if (!trimmed) {
      setYmd("")
      setDisplay("")
      setInvalid(false)
      return
    }
    const parsed = parseDmySlashToYmd(trimmed)
    if (parsed) {
      applyYmd(parsed)
      return
    }
    setYmd("")
    setDisplay(trimmed)
    setInvalid(true)
  }

  function onCalendarSelect(date: Date | undefined) {
    if (!date) return
    applyYmd(localDateToYmd(date))
    setOpen(false)
  }

  return (
    <div className={cn("space-y-1", className)}>
      <input type="hidden" name={name} value={ymd} required={required} disabled={disabled} />
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          data-dmy-date-text
          data-dmy-date-for={name}
          inputMode="numeric"
          autoComplete="off"
          placeholder="DD/MM/YYYY"
          aria-describedby={hintId}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          value={display}
          onChange={(e) => {
            setDisplay(e.target.value)
            if (invalid) setInvalid(false)
          }}
          onBlur={(e) => commitDisplay(e.target.value)}
          className={cn(
            "min-w-0 flex-1 rounded border bg-background px-3 py-2",
            invalid && "border-destructive",
            disabled && "cursor-not-allowed opacity-50",
          )}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            type="button"
            disabled={disabled}
            aria-label="Choose date from calendar"
            className={cn(buttonVariants({ variant: "outline", size: "icon" }), "shrink-0")}
          >
            <CalendarIcon className="size-4" />
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              locale={enIN}
              weekStartsOn={1}
              selected={selectedDate}
              onSelect={onCalendarSelect}
              defaultMonth={selectedDate}
              disabled={disabled}
            />
          </PopoverContent>
        </Popover>
      </div>
      <span id={hintId} className="text-xs text-muted-foreground">
        DD/MM/YYYY — type or use the calendar
      </span>
    </div>
  )
}
