"use client"

import { Capacitor } from "@capacitor/core"

type Listener = () => void
type SupportedPlatform = "ios" | "android"

const GUIDE_CLOSE_SETTLE_MS = 350

let guideOpen = false
let guideAcceptedThisSession = false
let pendingGuidePromise: Promise<boolean> | null = null
let settlePendingGuide: ((accepted: boolean) => void) | null = null
let activePlatform: SupportedPlatform | null = null

const listeners = new Set<Listener>()

function emitChange() {
  for (const listener of listeners) {
    listener()
  }
}

export function isNativePermissionGuideSupported() {
  if (typeof window === "undefined" || !Capacitor.isNativePlatform()) {
    return false
  }

  const platform = Capacitor.getPlatform()
  return platform === "ios" || platform === "android"
}

export function getNativePermissionGuideState() {
  return {
    open: guideOpen,
    platform: activePlatform,
  }
}

export function subscribeNativePermissionGuide(listener: Listener) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

function closeNativePermissionGuide(accepted: boolean) {
  const resolve = settlePendingGuide

  guideOpen = false
  activePlatform = null
  pendingGuidePromise = null
  settlePendingGuide = null

  if (accepted) {
    guideAcceptedThisSession = true
  }

  emitChange()
  if (!resolve) {
    return
  }

  if (!accepted) {
    resolve(false)
    return
  }

  window.setTimeout(() => {
    resolve(true)
  }, GUIDE_CLOSE_SETTLE_MS)
}

export async function ensureNativePermissionGuide() {
  if (!isNativePermissionGuideSupported() || guideAcceptedThisSession) {
    return true
  }

  if (pendingGuidePromise) {
    return pendingGuidePromise
  }

  pendingGuidePromise = new Promise<boolean>((resolve) => {
    settlePendingGuide = resolve
  })

  activePlatform = Capacitor.getPlatform() as SupportedPlatform
  guideOpen = true
  emitChange()

  return pendingGuidePromise
}

export function acceptNativePermissionGuide() {
  closeNativePermissionGuide(true)
}

export function dismissNativePermissionGuide() {
  closeNativePermissionGuide(false)
}
