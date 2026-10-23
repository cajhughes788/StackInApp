'use client'

import { AlertCircle } from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from '@/components/ui/toast'

// How long a notice stays up unless a caller sets its own duration: errors
// a little longer, since there's more to read.
const DEFAULT_DURATION_MS = 4000
const ERROR_DURATION_MS = 6000

// Messages in the middle of the screen, for the signed-out pages (login,
// signup), where the iOS keyboard is usually up and would cover the default
// bottom position. Horizontal centring comes from the base viewport's auto
// margins (.stackin-safe-message-viewport in globals.css); only the vertical
// shift is added here, so there's no second horizontal shift to stack.
export const CENTERED_TOAST_VIEWPORT =
  'top-1/2 bottom-auto w-[calc(100%-2rem)] max-w-[420px] -translate-y-1/2 flex-col p-0'

// Every message has an always-visible X in the top-right corner, so it can be
// cleared straight away instead of waiting for it to time out.
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
            className="pr-11"
            {...props}
          >
            {isError ? <AlertCircle className="size-[18px] shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" /> : null}
            {/* Tapping the message dismisses it; the action stays its own button. */}
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => dismiss(id)}>
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription className={cn(title && 'mt-0.5')}>{description}</ToastDescription>}
            </button>
            {action}
            <ToastClose
              aria-label="Dismiss"
              className="right-1.5 top-1.5 rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground sm:opacity-100 group-[.destructive]:text-muted-foreground group-[.destructive]:hover:text-foreground"
            />
          </Toast>
        )
      })}
      <ToastViewport className={cn(viewportClassName)} />
    </ToastProvider>
  )
}
