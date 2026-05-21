import { Capacitor, registerPlugin } from "@capacitor/core"

type NativePrintPlugin = {
  printHtml(options: { html: string; jobName?: string }): Promise<{ completed: boolean }>
}

const CapacitorNativePrint = registerPlugin<NativePrintPlugin>("NativePrint")

export class NativePrint {
  static isAvailable() {
    return typeof window !== "undefined" && Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios"
  }

  static async printHtml(html: string, jobName: string): Promise<{ completed: boolean }> {
    if (!this.isAvailable()) {
      throw new Error("Native printing is not available on this platform.")
    }

    return CapacitorNativePrint.printHtml({
      html,
      jobName,
    })
  }
}
