import { cn } from "@/lib/utils"

// A form-check message shown under the field it's about, instead of a
// notification. Renders nothing without a message.
export function FieldError({ message, className }: { message?: string | null; className?: string }) {
  if (!message) return null
  return (
    <p role="alert" className={cn("text-xs font-normal text-red-700 dark:text-red-400", className)}>
      {message}
    </p>
  )
}
