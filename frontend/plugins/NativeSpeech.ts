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
  // Ask 521: reads a short answer aloud with the iPhone's own voice.
  speak(options: { text: string }): Promise<void>
  stopSpeaking(): Promise<void>
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

/** Reads a short answer aloud (iPhone only); quietly does nothing elsewhere. */
export function speakAloud(text: string): void {
  if (!isNativeSpeechAvailable() || !text.trim()) return
  void NativeSpeech.speak({ text: text.slice(0, 600) }).catch(() => {})
}

export function stopSpeakingAloud(): void {
  if (!isNativeSpeechAvailable()) return
  void NativeSpeech.stopSpeaking().catch(() => {})
}
