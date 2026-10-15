"use client"

import { useId } from "react"

import { Input } from "@/components/ui/input"

// "Who paid you?" — a text field that suggests the workspace's saved income
// names (lib/incomeNames.ts) as you type, but accepts a new one. A native
// datalist keeps it light on mobile: it shows the platform's own suggestion
// list without a custom dropdown.
export default function IncomeNameInput({
  value,
  onChange,
  savedNames,
  id,
  placeholder = "Who paid you? e.g. DoorDash",
  className,
  "aria-label": ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  savedNames: string[]
  id?: string
  placeholder?: string
  className?: string
  "aria-label"?: string
}) {
  const listId = useId()
  return (
    <>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={listId}
        placeholder={placeholder}
        autoComplete="off"
        maxLength={60}
        className={className}
        aria-label={ariaLabel}
      />
      <datalist id={listId}>
        {savedNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </>
  )
}
