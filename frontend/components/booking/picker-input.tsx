"use client"

import type { InputHTMLAttributes } from "react"

import { softInputClass } from "@/components/invoices/invoice-ui"
import { cn } from "@/lib/utils"

// A date or time box that behaves on iPhone: WebKit gives these inputs a
// minimum width no CSS can shrink (so two side by side spill out of their
// card), top-aligns the value once appearance is off, and shows nothing at
// all while empty. The wrapper clips the box to its column, the line height
// centers the value, and the placeholder sits behind until a value is picked.
export function PickerInput({
  type,
  value,
  placeholder,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value"> & {
  type: "date" | "time"
  value: string
  placeholder: string
}) {
  return (
    <span className="relative block w-full min-w-0 overflow-hidden rounded-xl">
      <input
        type={type}
        value={value}
        className={cn(
          softInputClass,
          "block w-full min-w-0 max-w-full appearance-none py-0 text-left leading-[2.75rem] [&::-webkit-date-and-time-value]:text-left",
          className
        )}
        {...rest}
      />
      {value ? null : (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[15px] text-muted-foreground"
        >
          {placeholder}
        </span>
      )}
    </span>
  )
}
