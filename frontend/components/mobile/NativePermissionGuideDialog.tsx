"use client"

import { useEffect, useState } from "react"

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
import {
  acceptNativePermissionGuide,
  dismissNativePermissionGuide,
  getNativePermissionGuideState,
  subscribeNativePermissionGuide,
} from "@/lib/mobile/nativePermissionGuide"

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
          dismissNativePermissionGuide()
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Allow Location Reminders</AlertDialogTitle>
          <AlertDialogDescription>
            {isAndroid ? (
              <>
                StackIn is about to show the Android permission prompts needed
                for location-based reminders.
                <br />
                <br />
                1. Allow <strong>location while using the app</strong>.
                <br />
                2. If Android shows a second location step, choose{" "}
                <strong>Allow all the time</strong>.
              </>
            ) : (
              <>
                StackIn is about to show the iPhone permission prompts needed
                for location-based reminders.
                <br />
                <br />
                1. Tap <strong>Allow While Using App</strong> for location.
                <br />
                2. Tap <strong>Change to Always Allow</strong> on the follow-up
                location prompt.
                <br />
                <br />
                Do not tap <strong>Allow Once</strong>, or location reminders
                will stay limited.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={dismissNativePermissionGuide}>
            Not now
          </AlertDialogCancel>
          <AlertDialogAction onClick={acceptNativePermissionGuide}>
            Continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
