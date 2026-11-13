"use client"

import { cn } from "@/lib/utils"
import { fieldLabelClass, softInputClass } from "@/components/invoices/invoice-ui"
import { formatInvoiceDate } from "@shared/invoiceDisplay"
import { INVOICE_SCHEDULE_FREQUENCIES, INVOICE_SCHEDULE_FREQUENCY_LABELS, nextScheduleDate } from "@shared/invoiceSchedules"
import type { InvoiceScheduleEnd, InvoiceScheduleFrequency, InvoiceScheduleSendMode, InvoiceScheduleType } from "@shared/schemas/invoiceSchedule"

// How often a repeating invoice is made, when it ends, and whether each one
// is emailed or left as a draft — on the invoice form and the "Repeat this
// invoice" sheet (shared/schemas/invoiceSchedule.ts).

export type RepeatDraft = {
  frequency: InvoiceScheduleFrequency
  endType: InvoiceScheduleEnd["type"]
  endCount: string
  endDate: string
  sendMode: InvoiceScheduleSendMode
}

export function newRepeatDraft(): RepeatDraft {
  return { frequency: "monthly", endType: "never", endCount: "6", endDate: "", sendMode: "email" }
}

export function repeatDraftFrom(schedule: InvoiceScheduleType): RepeatDraft {
  return {
    frequency: schedule.frequency,
    endType: schedule.end.type,
    endCount: schedule.end.type === "count" ? String(schedule.end.count) : "6",
    endDate: schedule.end.type === "date" ? schedule.end.date : "",
    sendMode: schedule.sendMode,
  }
}

/**
 * The end as the server takes it, or an error to show. `firstDate` is the
 * first invoice's date; `nextDate`, when known, the next one to be made.
 */
export function repeatEnd(draft: RepeatDraft, firstDate: string, nextDate?: string): { end: InvoiceScheduleEnd } | { error: string } {
  if (draft.endType === "never") return { end: { type: "never" } }
  if (draft.endType === "count") {
    const count = Number(draft.endCount)
    if (!Number.isInteger(count) || count < 2 || count > 500) return { error: "Pick 2 or more invoices in all." }
    return { end: { type: "count", count } }
  }
  if (!draft.endDate) return { error: "Pick the date it ends." }
  if (draft.endDate < (nextDate ?? nextScheduleDate(firstDate, draft.frequency, firstDate))) {
    return { error: "It would end before the next invoice — pick a later date." }
  }
  return { end: { type: "date", date: draft.endDate } }
}

const END_OPTIONS: Array<{ id: InvoiceScheduleEnd["type"]; label: string }> = [
  { id: "never", label: "Never" },
  { id: "count", label: "After" },
  { id: "date", label: "On a date" },
]

function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  columns,
}: {
  options: Array<{ id: T; label: string }>
  value: T
  onChange: (value: T) => void
  label: string
  columns: string
}) {
  return (
    <div role="group" aria-label={label} className={cn("grid gap-1 rounded-[14px] bg-muted p-1", columns)}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            "min-h-10 rounded-[10px] px-1 text-sm leading-tight transition-colors",
            value === option.id ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function RepeatOptions({
  draft,
  onChange,
  firstDate,
  clientHasEmail,
  nextDate,
  error,
}: {
  draft: RepeatDraft
  onChange: (draft: RepeatDraft) => void
  // The first invoice's date: the next one's date is worked out from it.
  firstDate: string
  clientHasEmail: boolean
  // An existing schedule's next date (while its frequency is unchanged).
  nextDate?: string
  error?: string | null
}) {
  const set = (patch: Partial<RepeatDraft>) => onChange({ ...draft, ...patch })
  const second = nextDate ?? nextScheduleDate(firstDate, draft.frequency, firstDate)
  return (
    <div className="space-y-3.5">
      <div className="space-y-1.5">
        <div className="text-sm font-medium text-muted-foreground">How often</div>
        <select
          className={softInputClass}
          value={draft.frequency}
          onChange={(event) => set({ frequency: event.target.value as InvoiceScheduleFrequency })}
          aria-label="How often"
        >
          {INVOICE_SCHEDULE_FREQUENCIES.map((frequency) => (
            <option key={frequency} value={frequency}>
              {INVOICE_SCHEDULE_FREQUENCY_LABELS[frequency]}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">Next one: {formatInvoiceDate(second)}</p>
      </div>

      <div className="space-y-1.5">
        <div className="text-sm font-medium text-muted-foreground">Ends</div>
        <Segmented options={END_OPTIONS} value={draft.endType} onChange={(endType) => set({ endType })} label="Ends" columns="grid-cols-3" />
        {draft.endType === "count" ? (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            After
            <input
              className={cn(softInputClass, "w-20 tabular-nums")}
              inputMode="numeric"
              value={draft.endCount}
              onChange={(event) => set({ endCount: event.target.value.replace(/\D/g, "").slice(0, 3) })}
              aria-label="Invoices in all"
            />
            invoices in all, this one included
          </label>
        ) : draft.endType === "date" ? (
          <label className={fieldLabelClass}>
            Last invoice on or before
            <input type="date" className={softInputClass} value={draft.endDate} min={second} onChange={(event) => set({ endDate: event.target.value })} />
          </label>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <div className="text-sm font-medium text-muted-foreground">When each one is made</div>
        <Segmented
          options={[
            { id: "email" as const, label: "Email it automatically" },
            { id: "draft" as const, label: "Save as a draft" },
          ]}
          value={draft.sendMode}
          onChange={(sendMode) => set({ sendMode })}
          label="When each one is made"
          columns="grid-cols-2"
        />
        <p className="text-xs text-muted-foreground">
          {draft.sendMode === "draft"
            ? "You'll get a notification to check it and send it."
            : clientHasEmail
              ? "521 emails it to the client and lets you know."
              : "Add the client's email — until then each one is saved as a draft for you to send."}
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
