'use client'

import { AlertCircle } from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { Toast, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from '@/components/ui/toast'

// How long a notice stays up unless a caller sets its own duration: errors
// a little longer, since there's more to read.
const DEFAULT_DURATION_MS = 4000
const ERROR_DURATION_MS = 6000

export function Toaster({ viewportClassName }: { viewportClassName?: string }) {
  const { toasts, dismiss } = useToast()

  return (
    <ToastProvider swipeDirection="down">
      {toasts.map(function ({ id, title, description, action, variant, duration, ...props }) {
        const isError = variant === 'destructive'
        return (
          <Toast
            key={id}
            variant={variant}
            duration={duration ?? (isError ? ERROR_DURATION_MS : DEFAULT_DURATION_MS)}
            {...props}
          >
            {isError ? <AlertCircle className="size-[18px] shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" /> : null}
            {/* Tapping the message dismisses it; the action stays its own button. */}
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => dismiss(id)}>
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription className={cn(title && 'mt-0.5')}>{description}</ToastDescription>}
            </button>
            {action}
          </Toast>
        )
      })}
      <ToastViewport className={cn(viewportClassName)} />
    </ToastProvider>
  )
}
