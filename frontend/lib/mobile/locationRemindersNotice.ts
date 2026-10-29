"use client"

import { create } from "zustand"

// "Location reminders are off": shown right after the iPhone questions when
// the answers weren't enough for location reminders (Always location plus
// notifications). See LocationRemindersOffDialog.
export type LocationRemindersOffReason = "location" | "notifications"

type LocationRemindersNoticeState = {
  reason: LocationRemindersOffReason | null
  show: (reason: LocationRemindersOffReason) => void
  close: () => void
}

export const useLocationRemindersNotice = create<LocationRemindersNoticeState>((set) => ({
  reason: null,
  show: (reason) => set({ reason }),
  close: () => set({ reason: null }),
}))

export function showLocationRemindersOffNotice(status: { backgroundGranted?: boolean }) {
  useLocationRemindersNotice.getState().show(status.backgroundGranted ? "notifications" : "location")
}

// Navigating a WKWebView to app-settings: opens 521's page in the iPhone
// Settings app (iOS hands it to UIApplication.open).
export function openIosAppSettings() {
  if (typeof window !== "undefined") {
    window.location.href = "app-settings:"
  }
}
