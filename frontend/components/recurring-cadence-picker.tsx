"use client"

import type { RecurringCadence } from "@shared/schemas/recurringRule"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

type FieldsProps = {
  idPrefix: string
  cadence: RecurringCadence
  onCadenceChange: (cadence: RecurringCadence) => void
  endDate: string
  onEndDateChange: (value: string) => void
  minEndDate?: string
}

// Frequency select + end-date fields, no enabled-switch. Used where the
// "enabled" state is driven externally (e.g. entry-form.tsx's per-field
// Repeats switches, where only one field's switch controls visibility of a
// single shared panel rather than each field owning its own switch).
export function RecurringCadenceFields({
  idPrefix,
  cadence,
  onCadenceChange,
  endDate,
  onEndDateChange,
  minEndDate,
}: FieldsProps) {
  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor={`${idPrefix}-repeat-freq`}>Frequency</Label>
        <Select
          value={cadence.freq}
          onValueChange={(value) => {
            if (value === "weekly" || value === "biweekly" || value === "monthly") {
              onCadenceChange({ freq: value })
            } else if (value === "custom_days") {
              onCadenceChange({ freq: "custom_days", intervalDays: 30 })
            }
          }}
        >
          <SelectTrigger id={`${idPrefix}-repeat-freq`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="biweekly">Every 2 weeks</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
            <SelectItem value="custom_days">Custom interval</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {cadence.freq === "custom_days" ? (
        <div>
          <Label htmlFor={`${idPrefix}-repeat-interval`}>Every how many days</Label>
          <Input
            id={`${idPrefix}-repeat-interval`}
            type="number"
            min={1}
            max={365}
            step={1}
            value={cadence.intervalDays}
            onChange={(event) => {
              const parsed = Number(event.target.value)
              onCadenceChange({
                freq: "custom_days",
                intervalDays: Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 1,
              })
            }}
          />
        </div>
      ) : null}

      <div>
        <Label htmlFor={`${idPrefix}-repeat-end`}>End date (Optional)</Label>
        <Input
          id={`${idPrefix}-repeat-end`}
          type="date"
          value={endDate}
          min={minEndDate}
          onChange={(event) => onEndDateChange(event.target.value)}
        />
      </div>
    </div>
  )
}

type Props = FieldsProps & {
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  label?: string
}

export default function RecurringCadencePicker({
  idPrefix,
  enabled,
  onEnabledChange,
  cadence,
  onCadenceChange,
  endDate,
  onEndDateChange,
  minEndDate,
  label = "Repeats",
}: Props) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/10 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={`${idPrefix}-repeat-toggle`}>{label}</Label>
        <Switch
          id={`${idPrefix}-repeat-toggle`}
          checked={enabled}
          onCheckedChange={onEnabledChange}
        />
      </div>

      {enabled ? (
        <RecurringCadenceFields
          idPrefix={idPrefix}
          cadence={cadence}
          onCadenceChange={onCadenceChange}
          endDate={endDate}
          onEndDateChange={onEndDateChange}
          minEndDate={minEndDate}
        />
      ) : null}
    </div>
  )
}
