"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { openIosAppSettings, useLocationRemindersNotice } from "@/lib/mobile/locationRemindersNotice"

// Shown after the iPhone permission questions when location ended up short
// of Always (or notifications are off). The reminder is turned off with it.
export function LocationRemindersOffDialog() {
  const reason = useLocationRemindersNotice((s) => s.reason)
  const close = useLocationRemindersNotice((s) => s.close)

  return (
    <AlertDialog open={reason !== null} onOpenChange={(open) => { if (!open) close() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Location reminders are off</AlertDialogTitle>
          <AlertDialogDescription>
            {reason === "notifications" ? (
              <>
                They need notifications allowed so 521 can alert you, so we
                turned them off. You can turn them back on anytime: Settings
                → 521 → <strong>Notifications</strong>, then turn them on in
                521.
              </>
            ) : (
              <>
                They only work when location is set to <strong>Always</strong>,
                so we turned them off. You can turn them back on anytime:
                Settings → 521 → Location → <strong>Always</strong>, then turn
                them on in 521.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={close}>OK</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              close()
              openIosAppSettings()
            }}
          >
            Open Settings
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
