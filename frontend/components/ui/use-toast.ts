'use client'

// The one toast store is hooks/use-toast.ts — the one <Toaster> renders. This
// path used to hold a separate copy with its own state, so toasts sent
// through it (Settings, the support dialog, the location picker) were never
// shown.
export { reducer, toast, useToast } from '@/hooks/use-toast'
