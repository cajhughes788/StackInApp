"use client"

// Ask 521 — Home's mic. Ask a question ("how much did I make this week?"),
// open a page ("show my October P&L"), or say something to log ("42 on gas
// at Shell", which goes to that form's own voice fill). Only the words, and
// client and category names, go to the server; it says only WHAT was asked.
// Every number is worked out here from the person's own data
// (lib/voiceAskAnswer.ts), with the same math the screens use.

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronRight, Mic, Square, Volume2, VolumeX, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useSpeechCapture } from "@/hooks/useSpeechCapture"
import { parseVoiceAsk, wakeVoiceEntry } from "@/lib/api/voiceEntryApi"
import { getVisibleExpenseCategoryOptions } from "@/lib/expenseCategories"
import { getLocalDateInputValue } from "@/lib/helpers"
import { useAskFocusStore } from "@/lib/stores/useAskFocusStore"
import { useClientsStore } from "@/lib/stores/useClientsStore"
import { useSettingsData } from "@/lib/stores/useSettingsStore"
import { useVoiceHandoffStore } from "@/lib/stores/useVoiceHandoffStore"
import { useVoiceLaunchStore } from "@/lib/stores/useVoiceLaunchStore"
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore"
import { answerQuestion, cantAnswer, logTargetAllowed, pageHref, type AskAnswer } from "@/lib/voiceAskAnswer"
import { loadAskData } from "@/lib/voiceAskData"
import { speakAloud, stopSpeakingAloud } from "@/plugins/NativeSpeech"
import { isVoiceLaunchAvailable } from "@/plugins/VoiceLaunch"
import { buildClientRows } from "@shared/clients"
import type { VoiceAskForm } from "@shared/voiceAsk"

const READ_ALOUD_KEY = "521.askReadAloud"
const SIRI_TIP_KEY = "521.siriTipSeen"

/** The Siri / Action Button tip: iPhones on iOS 16+ (where the phrases exist), until dismissed. */
function shouldShowSiriTip(): boolean {
  if (!isVoiceLaunchAvailable()) return false
  const version = Number(/OS (\d+)_/.exec(navigator.userAgent)?.[1] ?? 0)
  if (version < 16) return false
  try {
    return window.localStorage.getItem(SIRI_TIP_KEY) !== "seen"
  } catch {
    return false
  }
}

function readAloudPreference(): boolean {
  try {
    return window.localStorage.getItem(READ_ALOUD_KEY) !== "off"
  } catch {
    return true
  }
}

// Where each "log" goes when it isn't a form on Home.
const LOG_PAGES: Partial<Record<VoiceAskForm, string>> = {
  invoice: "/app/invoices/edit?voiceText=1",
  quote: "/app/invoices/edit?kind=quote&voiceText=1",
  booking: "/app/booking?voiceText=1",
  client: "/app/invoices?view=clients&voiceText=1",
}

export default function Ask521({
  className = "",
  onShowForm,
}: {
  className?: string
  // Home shows the Add entry or Add expense form for a "log".
  onShowForm: (form: "entry" | "expense") => void
}) {
  const router = useRouter()
  const workspaceState = useWorkspaceStore((s) => s.state)
  const workspaceId = workspaceState.status === "ready" ? workspaceState.activeWorkspaceId : null
  const workspaceType = workspaceState.status === "ready" ? (workspaceState.activeWorkspace.type === "independent" ? "independent" : "w2") : null
  const settings = useSettingsData(workspaceId)
  const clients = useClientsStore((state) => (workspaceId ? state.byWorkspaceId[workspaceId]?.clients : undefined))
  const loadClients = useClientsStore((state) => state.load)
  const sendHandoff = useVoiceHandoffStore((state) => state.send)
  const showFocus = useAskFocusStore((state) => state.show)
  const clearFocus = useAskFocusStore((state) => state.clear)

  const [phase, setPhase] = useState<"idle" | "thinking" | "checking">("idle")
  const [heard, setHeard] = useState("")
  const [reply, setReply] = useState<AskAnswer | null>(null)
  const [readAloud, setReadAloud] = useState(true)
  const runRef = useRef(0)

  const [siriTip, setSiriTip] = useState(false)
  useEffect(() => {
    setReadAloud(readAloudPreference())
    setSiriTip(shouldShowSiriTip())
  }, [])
  function dismissSiriTip() {
    setSiriTip(false)
    try {
      window.localStorage.setItem(SIRI_TIP_KEY, "seen")
    } catch {
      // Shown again next time, then.
    }
  }
  // Client names help the words come out spelled right.
  useEffect(() => {
    if (workspaceId && workspaceType === "independent") void loadClients(workspaceId).catch(() => {})
  }, [loadClients, workspaceId, workspaceType])

  const clientNames = useMemo(() => (clients ?? []).filter((c) => !c.archived).map((c) => c.name), [clients])
  const categories = useMemo(
    () =>
      workspaceType === "independent"
        ? getVisibleExpenseCategoryOptions(settings?.independent?.customExpenseCategories ?? [], {
            workspaceType: "independent",
            independentSettings: settings?.independent ?? null,
          }).slice(0, 150)
        : [],
    [settings?.independent, workspaceType]
  )
  const includeUnreported =
    (workspaceType === "w2" ? settings?.w2?.includeUnreportedInUI : settings?.independent?.includeUnreportedInUI) ?? false

  function show(answer: AskAnswer) {
    setReply(answer)
    if (readAloud) speakAloud(answer.speak)
  }

  async function handleTranscript(transcript: string) {
    if (!workspaceId || !workspaceType) return
    const run = ++runRef.current
    setPhase("thinking")
    setHeard(transcript)
    setReply(null)
    const today = getLocalDateInputValue()
    try {
      const result = await parseVoiceAsk({
        kind: "ask",
        transcript,
        today,
        workspaceType,
        clients: clientNames.slice(0, 300),
        expenseCategories: categories,
      })
      if (run !== runRef.current) return

      if (result.intent === "log") {
        if (!logTargetAllowed(result.form, workspaceType) || !result.form) {
          show(cantAnswer())
          return
        }
        // "Add an expense" with nothing else: open that form already listening.
        sendHandoff(result.form, transcript, workspaceId, !result.hasDetails)
        setHeard("")
        if (result.form === "entry" || result.form === "expense") onShowForm(result.form)
        else router.push(LOG_PAGES[result.form] as string)
        return
      }

      if (result.intent === "open") {
        const clientRows = result.page === "client" ? await clientRowsNow(workspaceId, today) : []
        const link = pageHref(result, { today, workspaceType, clientRows })
        if (!link) {
          show({ ...cantAnswer(), text: result.page === "client" ? "Couldn't find that client." : "That page isn't in this workspace.", speak: "I couldn't open that." })
          return
        }
        setHeard("")
        router.push(link.href)
        return
      }

      if (result.intent === "question" && result.topic) {
        setPhase("checking")
        const data = await loadAskData(result, { workspaceId, workspaceType, includeUnreported, today })
        if (run !== runRef.current) return
        show(answerQuestion(result, data))
        return
      }

      show(cantAnswer())
    } catch (error) {
      if (run !== runRef.current) return
      console.warn("[Ask521] failed", error)
      const limited = (error as { status?: number })?.status === 429
      const text = limited && error instanceof Error ? error.message : "Couldn't work that out just now. Try again."
      setReply({ text, speak: text, details: [], items: [], link: null })
    } finally {
      if (run === runRef.current) setPhase("idle")
    }
  }

  async function clientRowsNow(id: string, today: string) {
    await loadClients(id).catch(() => {})
    const entry = useClientsStore.getState().byWorkspaceId[id]
    return buildClientRows(entry?.clients ?? [], entry?.payments ?? {}, [], today)
  }

  const speech = useSpeechCapture((transcript) => void handleTranscript(transcript))

  function start() {
    wakeVoiceEntry()
    stopSpeakingAloud()
    setReply(null)
    setHeard("")
    speech.resetStatus()
    const hints = [
      "how much did I make", "this week", "last month", "who owes me", "what's on tomorrow", "profit", "tips", "P&L",
      ...categories.filter((name) => name.length <= 30),
      ...clientNames.slice(0, 40),
    ]
    void speech.start(hints.slice(0, 100))
  }

  function toggleReadAloud() {
    const next = !readAloud
    setReadAloud(next)
    if (!next) stopSpeakingAloud()
    try {
      window.localStorage.setItem(READ_ALOUD_KEY, next ? "on" : "off")
    } catch {
      // Remembered only when it can be.
    }
  }

  function close() {
    runRef.current += 1
    stopSpeakingAloud()
    setReply(null)
    setHeard("")
    setPhase("idle")
  }

  // "Hey Siri, Ask 521" / the Action Button: start listening once the mic is known.
  const launch = useVoiceLaunchStore((state) => state.request)
  useEffect(() => {
    if (launch?.target !== "ask" || !speech.checked || !workspaceId) return
    if (!useVoiceLaunchStore.getState().take("ask")) return
    if (speech.supported) start()
    // start reads the latest lists each render; only the request matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launch, speech.checked, speech.supported, workspaceId])

  if (!speech.supported || !workspaceId) return null
  const listening = speech.status === "listening"

  return (
    <section className={`space-y-3 ${className}`} aria-label="Ask 521">
      <div className="flex items-center gap-2">
        {listening ? (
          <Button
            type="button"
            className="h-12 flex-1 animate-pulse rounded-full bg-[#2FA866] text-base font-semibold text-white hover:bg-[#2FA866]/90"
            onClick={speech.done}
            aria-label="Stop and answer"
          >
            <Square className="size-4 fill-current" /> Done
          </Button>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={phase !== "idle"}
            className="flex h-12 flex-1 items-center gap-3 rounded-full bg-muted px-4 text-left text-base text-muted-foreground transition-colors hover:bg-secondary"
          >
            <Mic className="size-5 shrink-0 text-foreground" aria-hidden="true" />
            <span className="truncate">Ask 521, or say something to log</span>
          </button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-12 shrink-0 rounded-full text-muted-foreground"
          onClick={toggleReadAloud}
          aria-label={readAloud ? "Stop reading answers aloud" : "Read answers aloud"}
          aria-pressed={readAloud}
        >
          {readAloud ? <Volume2 /> : <VolumeX />}
        </Button>
      </div>

      {siriTip && !listening && phase === "idle" && !reply ? (
        <div className="flex items-start gap-3 rounded-2xl bg-muted px-4 py-3">
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            Tip: say &ldquo;Hey Siri, Ask 521&rdquo; from anywhere. Or put it on your Action Button: Settings › Action Button ›
            Shortcut › 521 › Ask 521.
          </p>
          <Button type="button" size="sm" variant="ghost" className="shrink-0 rounded-full" onClick={dismissSiriTip}>
            Got it
          </Button>
        </div>
      ) : null}

      {listening ? (
        <div className="space-y-2 rounded-2xl bg-muted px-4 py-3" aria-live="polite">
          <p className="text-base text-foreground">
            {speech.transcript || (
              <span className="text-muted-foreground">
                Try &ldquo;How much did I make this week?&rdquo;, &ldquo;Who owes me?&rdquo; or &ldquo;42 on gas at Shell.&rdquo;
              </span>
            )}
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={speech.cancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {phase !== "idle" ? (
        <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground" aria-live="polite">
          {phase === "checking" ? "Checking your numbers…" : "Working it out…"}
        </p>
      ) : null}
      {speech.status === "denied" ? (
        <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          The mic is off for 521. Turn on Microphone and Speech Recognition in Settings › 521.
        </p>
      ) : null}
      {speech.status === "error" ? (
        <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">Couldn&apos;t hear that. Tap to try again.</p>
      ) : null}

      {reply && phase === "idle" && !listening ? (
        <div className="space-y-3 rounded-[22px] border border-card-border bg-card px-4 py-4" aria-live="polite">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              {heard ? <p className="text-sm text-muted-foreground">&ldquo;{heard}&rdquo;</p> : null}
              <p className="text-lg font-semibold leading-snug text-foreground">{reply.text}</p>
              {reply.details.map((line) => (
                <p key={line} className="text-sm tabular-nums text-muted-foreground">
                  {line}
                </p>
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="-mr-2 -mt-1 size-9 shrink-0 rounded-full text-muted-foreground"
              onClick={close}
              aria-label="Close the answer"
            >
              <X />
            </Button>
          </div>
          {reply.items.length > 0 ? (
            <ul className="overflow-hidden rounded-2xl bg-muted">
              {reply.items.map((item) => (
                <li key={item.href + item.label} className="border-b border-border last:border-0">
                  <Link href={item.href} onClick={clearFocus} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">{item.label}</span>
                      {item.sub ? <span className="block truncate text-sm text-muted-foreground">{item.sub}</span> : null}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {reply.link ? (
            <Button asChild variant="secondary" className="h-11 w-full rounded-full">
              <Link
                href={reply.link.href}
                onClick={() => {
                  // Light up where the answer came from on the page it opens.
                  const link = reply.link
                  if (link?.focus) showFocus({ ...link.focus, path: link.href.split("?")[0] })
                  else clearFocus()
                }}
              >
                {reply.link.label}
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
