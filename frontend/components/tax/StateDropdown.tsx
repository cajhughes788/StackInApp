// /app/tax/components/StateDropdown.tsx
"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { STATE_TAX_RATES } from "@shared/tax/tables/stateRates"


interface StateDropdownProps {
  value?: string
  onChange: (state: string) => void
  label?: string
  required?: boolean
  className?: string
  id?: string
}

/**
 * Dynamic dropdown listing all 50 states + D.C.
 * Uses the shared stateRates file for consistency with backend logic.
 */
export function StateDropdown({
  value,
  onChange,
  label = "State",
  required = false,
  className = "",
  id = "state",
}: StateDropdownProps) {
  const stateKeys = Object.keys(STATE_TAX_RATES)
    .filter((key) => key !== "Default")
    .sort((a, b) =>
      (STATE_TAX_RATES[a].displayName ?? a).localeCompare(
        STATE_TAX_RATES[b].displayName ?? b
      )
    )

  return (
    <div className={`space-y-2 ${className}`}>
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value}
        onValueChange={(val: string) => onChange(val)}
        required={required}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder="Select a state" />
        </SelectTrigger>
        <SelectContent>
          {stateKeys.map((key) => (
            <SelectItem key={key} value={key}>
              {STATE_TAX_RATES[key].displayName ?? key.charAt(0).toUpperCase() + key.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
