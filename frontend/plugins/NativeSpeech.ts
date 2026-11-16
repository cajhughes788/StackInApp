import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core"

// Voice entry's listener on iPhone (ios/App/App/NativeSpeechPlugin.swift).
// Only text comes back; 521 never receives audio.

export type NativeSpeechPermission = "granted" | "prompt" | "denied"

export type NativeSpeechStatus = {
  available: boolean
  // True when this iPhone recognizes speech on the phone itself.
  onDevice: boolean
  speech: NativeSpeechPermission
  microphone: NativeSpeechPermission
}

export type NativeSpeechFinishReason = "silence" | "stopped" | "limit" | "final" | "interrupted" | "error"

type NativeSpeechPlugin = {
  getStatus(): Promise<NativeSpeechStatus>
  requestPermissions(): Promise<{ granted: boolean }>
  start(options: { hints?: string[]; silenceMs?: number; firstWordsMs?: number; limitMs?: number }): Promise<{ onDevice: boolean }>
  stop(): Promise<void>
  cancel(): Promise<void>
  addListener(event: "partial", listener: (data: { text: string }) => void): Promise<PluginListenerHandle>
  addListener(
    event: "finished",
    listener: (data: { text: string; reason: NativeSpeechFinishReason }) => void
  ): Promise<PluginListenerHandle>
}

export const NativeSpeech = registerPlugin<NativeSpeechPlugin>("NativeSpeech")

export function isNativeSpeechAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === "ios" &&
    Capacitor.isPluginAvailable("NativeSpeech")
  )
}
