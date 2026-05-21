"use client"

import { Capacitor } from "@capacitor/core"

type ShareBlobOptions = {
  blob: Blob
  filename: string
  title?: string
  mimeType: string
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  let binary = ""
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

async function shareBlobFile({
  blob,
  filename,
  title,
  mimeType,
}: ShareBlobOptions): Promise<void> {
  if (typeof window === "undefined") {
    throw new Error("File sharing is only available in the browser.")
  }

  if (!Capacitor.isNativePlatform()) {
    triggerBrowserDownload(blob, filename)
    return
  }

  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ])

  const data = await blobToBase64(blob)
  const filePath = `exports/${Date.now()}-${filename}`

  await Filesystem.writeFile({
    path: filePath,
    data,
    directory: Directory.Documents,
    recursive: true,
  })

  const fileUri = await Filesystem.getUri({
    path: filePath,
    directory: Directory.Documents,
  })

  try {
    await Share.share({
      title: title ?? filename,
      dialogTitle: title ?? filename,
      url: fileUri.uri,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "")

    if (message.toLowerCase().includes("share canceled")) {
      return
    }

    throw error
  }
}

export async function exportCsvFile(
  filename: string,
  csv: string,
  title?: string
): Promise<void> {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  await shareBlobFile({
    blob,
    filename,
    title,
    mimeType: "text/csv",
  })
}

export async function shareHtmlFile(
  filename: string,
  html: string,
  title?: string
): Promise<void> {
  const blob = new Blob([html], { type: "text/html;charset=utf-8;" })
  await shareBlobFile({
    blob,
    filename,
    title,
    mimeType: "text/html",
  })
}

export async function shareElementAsPdf(
  element: HTMLElement,
  filename: string,
  title?: string
): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ])

  const canvas = await html2canvas(element, {
    backgroundColor: "#ffffff",
    scale: 2,
    useCORS: true,
    logging: false,
    windowWidth: element.scrollWidth,
    windowHeight: element.scrollHeight,
  })

  const imageData = canvas.toDataURL("image/png")
  const pdf = new jsPDF("p", "pt", "letter")
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const imageWidth = pageWidth
  const imageHeight = (canvas.height * imageWidth) / canvas.width

  let renderedHeight = 0
  let remainingHeight = imageHeight

  pdf.addImage(imageData, "PNG", 0, renderedHeight, imageWidth, imageHeight)
  remainingHeight -= pageHeight

  while (remainingHeight > 0) {
    renderedHeight -= pageHeight
    pdf.addPage()
    pdf.addImage(imageData, "PNG", 0, renderedHeight, imageWidth, imageHeight)
    remainingHeight -= pageHeight
  }

  const blob = pdf.output("blob")
  await shareBlobFile({
    blob,
    filename,
    title,
    mimeType: "application/pdf",
  })
}
