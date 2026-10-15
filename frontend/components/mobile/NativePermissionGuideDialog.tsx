"use client"

import { useEffect, useState } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  acceptNativePermissionGuide,
  getNativePermissionGuideState,
  subscribeNativePermissionGuide,
} from "@/lib/mobile/nativePermissionGuide"

// App Review (5.1.1(iv)) requires that a pre-permission message always
// proceeds to the system prompt, so there is no "Not now" path here and any
// way of closing the dialog continues to the permission request.
export function NativePermissionGuideDialog() {
  const [guideState, setGuideState] = useState(getNativePermissionGuideState())

  useEffect(() => {
    return subscribeNativePermissionGuide(() => {
      setGuideState(getNativePermissionGuideState())
    })
  }, [])

  const isAndroid = guideState.platform === "android"

  return (
    <AlertDialog
      open={guideState.open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          acceptNativePermissionGuide()
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Allow Location Reminders</AlertDialogTitle>
          <AlertDialogDescription>
            {isAndroid ? (
              <>
                521 is about to show the Android permission prompts needed
                for location-based reminders.
                <br />
                <br />
                Reminders that trigger when you arrive at a saved place work
                best with location set to <strong>Allow all the time</strong>.
                You can change this anytime in Settings.
              </>
            ) : (
              <>
                521 is about to show the iPhone permission prompts needed
                for location-based reminders.
                <br />
                <br />
                Reminders that trigger when you arrive at a saved place work
                best with location set to <strong>Always</strong>. You can
                change this anytime in Settings.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={acceptNativePermissionGuide}>
            Continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
