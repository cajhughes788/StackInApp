"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Capacitor, type PluginListenerHandle } from "@capacitor/core"
import { SpeechRecognition } from "@capacitor-community/speech-recognition"

// Listens through the phone's own speech recognition (Apple's on iPhone,
// which may use Apple's servers). The audio never reaches 521; only the
// typed-out words come back.
// Stops by itself after a short pause once something has been said, or when
// the person taps Done.

export type SpeechCaptureStatus = "idle" | "listening" | "denied" | "unavailable" | "error"

// A pause this long after some words counts as finished talking.
const SILENCE_MS = 2200
// Nothing heard at all for this long: stop rather than listen forever.
const NOTHING_HEARD_MS = 10000

export function useSpeechCapture(onFinished: (transcript: string) => void) {
  const [supported, setSupported] = useState(false)
  // True once it's known whether the phone can listen.
  const [checked, setChecked] = useState(false)
  const [status, setStatus] = useState<SpeechCaptureStatus>("idle")
  const [transcript, setTranscript] = useState("")
  const transcriptRef = useRef("")
  const listenersRef = useRef<PluginListenerHandle[]>([])
  const timerRef = useRef<number | null>(null)
  const activeRef = useRef(false)
  const onFinishedRef = useRef(onFinished)
  onFinishedRef.current = onFinished

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("SpeechRecognition")) {
      setChecked(true)
      return
    }
    let cancelled = false
    SpeechRecognition.available()
      .then(({ available }) => {
        if (!cancelled) setSupported(available)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setChecked(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const removeListeners = async () => {
    const handles = listenersRef.current
    listenersRef.current = []
    await Promise.all(handles.map((handle) => handle.remove().catch(() => {})))
  }

  const finish = useCallback(async (deliver: boolean) => {
    if (!activeRef.current) return
    activeRef.current = false
    clearTimer()
    await SpeechRecognition.stop().catch(() => {})
    await removeListeners()
    setStatus("idle")
    const text = transcriptRef.current.trim()
    if (deliver && text) onFinishedRef.current(text)
  }, [])

  const armTimer = useCallback((ms: number) => {
    clearTimer()
    timerRef.current = window.setTimeout(() => void finish(true), ms)
  }, [finish])

  const start = useCallback(async () => {
    if (activeRef.current) return
    if (!supported) {
      setStatus("unavailable")
      return
    }
    try {
      let permission = await SpeechRecognition.checkPermissions()
      if (permission.speechRecognition !== "granted") {
        permission = await SpeechRecognition.requestPermissions()
      }
      if (permission.speechRecognition !== "granted") {
        setStatus("denied")
        return
      }
      transcriptRef.current = ""
      setTranscript("")
      activeRef.current = true
      setStatus("listening")
      listenersRef.current.push(
        await SpeechRecognition.addListener("partialResults", (data) => {
          const text = data.matches?.[0] ?? ""
          if (!activeRef.current || !text) return
          transcriptRef.current = text
          setTranscript(text)
          armTimer(SILENCE_MS)
        }),
        await SpeechRecognition.addListener("listeningState", (data) => {
          // The phone stopped on its own (e.g. its time limit): use what was heard.
          if (data.status === "stopped" && activeRef.current) void finish(true)
        })
      )
      armTimer(NOTHING_HEARD_MS)
      await SpeechRecognition.start({ language: "en-US", partialResults: true, popup: false })
    } catch (error) {
      console.warn("[VoiceEntry] speech start failed", error)
      activeRef.current = false
      clearTimer()
      await removeListeners()
      const message = error instanceof Error ? error.message : String(error)
      setStatus(/denied|permission/i.test(message) ? "denied" : "error")
    }
  }, [armTimer, finish, supported])

  // Leaving the screen stops listening and drops what was heard.
  useEffect(() => () => void finish(false), [finish])

  return {
    supported,
    checked,
    status,
    transcript,
    start,
    done: () => void finish(true),
    cancel: () => void finish(false),
    resetStatus: () => setStatus("idle"),
  }
}
