"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { PluginListenerHandle } from "@capacitor/core"
import { NativeSpeech, isNativeSpeechAvailable } from "@/plugins/NativeSpeech"

// Listens through Apple's speech recognition (ios/App/App/NativeSpeechPlugin.swift),
// on the phone itself when the iPhone supports it. 521 never receives audio;
// only the typed-out words come back. The plugin decides when the person has
// finished talking (a short pause) and gives the microphone back afterward.

export type SpeechCaptureStatus = "idle" | "listening" | "denied" | "unavailable" | "error"

// This long with no talking after some words counts as finished. The plugin
// measures it from the sound itself, so a slow word reply doesn't cut anyone off.
const SILENCE_MS = 2500
// Nothing heard at all for this long: stop rather than listen forever.
const FIRST_WORDS_MS = 8000

export function useSpeechCapture(onFinished: (transcript: string) => void) {
  const [supported, setSupported] = useState(false)
  // True once it's known whether the phone can listen.
  const [checked, setChecked] = useState(false)
  const [status, setStatus] = useState<SpeechCaptureStatus>("idle")
  const [transcript, setTranscript] = useState("")
  const listenersRef = useRef<PluginListenerHandle[]>([])
  const activeRef = useRef(false)
  const onFinishedRef = useRef(onFinished)
  onFinishedRef.current = onFinished

  useEffect(() => {
    if (!isNativeSpeechAvailable()) {
      setChecked(true)
      return
    }
    let cancelled = false
    NativeSpeech.getStatus()
      .then((result) => {
        if (!cancelled) setSupported(result.available)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setChecked(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const removeListeners = useCallback(async () => {
    const handles = listenersRef.current
    listenersRef.current = []
    await Promise.all(handles.map((handle) => handle.remove().catch(() => {})))
  }, [])

  const start = useCallback(async (hints: string[] = []) => {
    if (activeRef.current) return
    if (!supported) {
      setStatus("unavailable")
      return
    }
    try {
      const current = await NativeSpeech.getStatus()
      if (current.speech !== "granted" || current.microphone !== "granted") {
        const { granted } = await NativeSpeech.requestPermissions()
        if (!granted) {
          setStatus("denied")
          return
        }
      }
      activeRef.current = true
      setTranscript("")
      setStatus("listening")
      listenersRef.current.push(
        await NativeSpeech.addListener("partial", ({ text }) => {
          if (activeRef.current) setTranscript(text)
        }),
        await NativeSpeech.addListener("finished", ({ text, reason }) => {
          if (!activeRef.current) return
          activeRef.current = false
          void removeListeners()
          const heard = text.trim()
          if (heard) {
            setStatus("idle")
            onFinishedRef.current(heard)
          } else {
            setStatus(reason === "error" ? "error" : "idle")
          }
        })
      )
      await NativeSpeech.start({ hints, silenceMs: SILENCE_MS, firstWordsMs: FIRST_WORDS_MS })
    } catch (error) {
      console.warn("[VoiceEntry] speech start failed", error)
      activeRef.current = false
      await removeListeners()
      const message = error instanceof Error ? error.message : String(error)
      setStatus(/permission/i.test(message) ? "denied" : "error")
    }
  }, [removeListeners, supported])

  // Done: stop now and use what was heard (arrives as the "finished" event).
  const done = useCallback(() => {
    if (activeRef.current) void NativeSpeech.stop().catch(() => {})
  }, [])

  // Cancel: stop and drop what was heard.
  const cancel = useCallback(() => {
    if (!activeRef.current) return
    activeRef.current = false
    void NativeSpeech.cancel().catch(() => {})
    void removeListeners()
    setStatus("idle")
  }, [removeListeners])

  // Leaving the screen stops listening.
  useEffect(() => () => {
    if (activeRef.current) {
      activeRef.current = false
      void NativeSpeech.cancel().catch(() => {})
    }
    void removeListeners()
  }, [removeListeners])

  return {
    supported,
    checked,
    status,
    transcript,
    start,
    done,
    cancel,
    resetStatus: () => setStatus("idle"),
  }
}
