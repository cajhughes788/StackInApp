'use client'

import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast'

export function Toaster({ viewportClassName }: { viewportClassName?: string }) {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
<Toast key={id} {...props}>
  <div className="grid gap-1">
    {title && <ToastTitle>{title}</ToastTitle>}
    {description && <ToastDescription>{description}</ToastDescription>}
  </div>

  {/* Moved here so the X icon appears top-right */}
  <ToastClose />

  {action}
</Toast>

        )
      })}
      <ToastViewport className={cn(viewportClassName)} />
    </ToastProvider>
  )
}

