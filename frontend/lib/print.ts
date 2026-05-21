"use client"

import { NativePrint } from "@/plugins/NativePrint"

type PrintHtmlDocumentOptions = {
  title: string
  html: string
}

export async function printHtmlDocument({
  title,
  html,
}: PrintHtmlDocumentOptions): Promise<void> {
  if (NativePrint.isAvailable()) {
    const result = await NativePrint.printHtml(html, title)
    if (!result.completed) {
      return
    }
    return
  }

  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Printing is only available in the browser.")
  }

  const iframe = document.createElement("iframe")
  iframe.setAttribute("title", title)
  iframe.style.position = "fixed"
  iframe.style.right = "0"
  iframe.style.bottom = "0"
  iframe.style.width = "0"
  iframe.style.height = "0"
  iframe.style.border = "0"
  iframe.style.visibility = "hidden"

  document.body.appendChild(iframe)

  const cleanup = () => {
    window.setTimeout(() => {
      iframe.remove()
    }, 250)
  }

  try {
    const frameWindow = iframe.contentWindow
    if (!frameWindow) {
      cleanup()
      throw new Error("Unable to open print preview.")
    }

    frameWindow.document.open()
    frameWindow.document.write(html)
    frameWindow.document.close()

    await new Promise<void>((resolve) => {
      const handleLoad = () => {
        iframe.removeEventListener("load", handleLoad)
        resolve()
      }

      iframe.addEventListener("load", handleLoad)
      window.setTimeout(() => {
        iframe.removeEventListener("load", handleLoad)
        resolve()
      }, 150)
    })

    frameWindow.focus()
    frameWindow.print()
    cleanup()
  } catch (error) {
    cleanup()
    throw error
  }
}
