import { Capacitor } from "@capacitor/core"

// A pre-filled text in Messages, addressed to one number. iOS wants
// "sms:<number>&body=", everything else "sms:<number>?body=".
export function smsHref(phone: string, body: string): string {
  const number = phone.replace(/[^\d+]/g, "")
  const ios = Capacitor.getPlatform() === "ios" || /iPhone|iPad|iPod/.test(navigator.userAgent)
  return `sms:${number}${ios ? "&" : "?"}body=${encodeURIComponent(body)}`
}
