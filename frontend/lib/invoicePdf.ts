"use client"

import type { jsPDF as JsPDF } from "jspdf"
import {
  formatInvoiceDate,
  formatInvoiceMoney,
  invoiceDisplayStatus,
  invoiceFileName,
} from "@shared/invoiceDisplay"
import { invoiceBalanceDue } from "@shared/invoicePayments"
import { DEFAULT_INVOICE_ACCENT_COLOR, type InvoiceSettings, type InvoiceType } from "@shared/schemas/invoice"
import { sharePdfBlob } from "@/lib/documentExport"

// ---------------------------------------------------------------------------
// Invoice PDF, built on the device with jsPDF's vector text (not a
// screenshot), so it's sharp, searchable and small. Same content and status
// wording as the public page (shared/invoicePublicPage.ts).
//
// Uses the built-in Helvetica, which covers Latin text only — names in
// other scripts won't render until a font is embedded.
// ---------------------------------------------------------------------------

const INK: [number, number, number] = [22, 27, 30]
const MUTED: [number, number, number] = [91, 97, 102]
const LINE: [number, number, number] = [226, 225, 220]
const OVERDUE: [number, number, number] = [163, 38, 26]
const MARGIN = 48

function hexToRgb(hex: string): [number, number, number] {
  const safe = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : DEFAULT_INVOICE_ACCENT_COLOR
  return [parseInt(safe.slice(1, 3), 16), parseInt(safe.slice(3, 5), 16), parseInt(safe.slice(5, 7), 16)]
}

function localToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

export async function buildInvoicePdf(invoice: InvoiceType, settings: InvoiceSettings): Promise<Blob> {
  const { jsPDF } = await import("jspdf")
  const pdf: JsPDF = new jsPDF({ unit: "pt", format: "letter" })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const right = pageWidth - MARGIN
  const contentWidth = right - MARGIN
  const accent = hexToRgb(settings.accentColor)
  const status = invoiceDisplayStatus(invoice, localToday())

  const drawAccentBar = () => {
    pdf.setFillColor(...accent)
    pdf.rect(0, 0, pageWidth, 6, "F")
  }
  const ensureSpace = (y: number, needed: number): number => {
    if (y + needed <= pageHeight - MARGIN) return y
    pdf.addPage()
    drawAccentBar()
    return MARGIN
  }

  drawAccentBar()
  let y = MARGIN

  // Business block (left) and invoice title (right).
  let textLeft = MARGIN
  if (settings.logoDataUrl) {
    try {
      const props = pdf.getImageProperties(settings.logoDataUrl)
      const scale = Math.min(110 / props.width, 56 / props.height, 1)
      const w = props.width * scale
      const h = props.height * scale
      pdf.addImage(settings.logoDataUrl, props.fileType, MARGIN, y, w, h)
      textLeft = MARGIN + w + 14
    } catch (error) {
      console.warn("invoicePdf: skipping unreadable logo", error)
    }
  }
  pdf.setFont("helvetica", "bold").setFontSize(15).setTextColor(...INK)
  pdf.text(settings.businessName || " ", textLeft, y + 14)
  pdf.setFont("helvetica", "normal").setFontSize(10).setTextColor(...MUTED)
  const contactLines = [settings.businessEmail, settings.businessPhone].filter(Boolean)
  contactLines.forEach((line, index) => pdf.text(line, textLeft, y + 30 + index * 13))

  pdf.setFont("helvetica", "bold").setFontSize(24).setTextColor(...accent)
  pdf.text("INVOICE", right, y + 18, { align: "right" })
  pdf.setFont("helvetica", "normal").setFontSize(11).setTextColor(...INK)
  pdf.text(`#${invoice.number}`, right, y + 36, { align: "right" })
  pdf.setTextColor(...(status.tone === "overdue" ? OVERDUE : MUTED))
  pdf.text(status.label, right, y + 51, { align: "right" })

  y += 84

  // Billed to / dates.
  const columns: Array<[string, string]> = [
    ["BILLED TO", invoice.clientName],
    ["ISSUED", formatInvoiceDate(invoice.issueDate)],
    ["DUE", formatInvoiceDate(invoice.dueDate)],
  ]
  const columnWidth = contentWidth / columns.length
  let metaHeight = 0
  columns.forEach(([label, value], index) => {
    const x = MARGIN + index * columnWidth
    pdf.setFont("helvetica", "bold").setFontSize(8).setTextColor(...MUTED)
    pdf.text(label, x, y)
    pdf.setFont("helvetica", "normal").setFontSize(11).setTextColor(...INK)
    const wrapped: string[] = pdf.splitTextToSize(value, columnWidth - 12)
    pdf.text(wrapped, x, y + 15)
    metaHeight = Math.max(metaHeight, 15 + wrapped.length * 14)
  })
  y += metaHeight + 22

  // Line items.
  const drawTableHeader = () => {
    pdf.setFont("helvetica", "bold").setFontSize(8).setTextColor(...MUTED)
    pdf.text("DESCRIPTION", MARGIN, y)
    pdf.text("AMOUNT", right, y, { align: "right" })
    y += 8
    pdf.setDrawColor(...LINE).setLineWidth(1).line(MARGIN, y, right, y)
    y += 16
  }
  drawTableHeader()
  pdf.setFontSize(11)
  for (const line of invoice.lines) {
    pdf.setFont("helvetica", "normal").setTextColor(...INK)
    const wrapped: string[] = pdf.splitTextToSize(line.description, contentWidth - 110)
    const rowHeight = wrapped.length * 14 + 10
    const nextY = ensureSpace(y, rowHeight + 4)
    if (nextY !== y) {
      y = nextY
      drawTableHeader()
      pdf.setFont("helvetica", "normal").setFontSize(11).setTextColor(...INK)
    }
    pdf.text(wrapped, MARGIN, y)
    pdf.text(formatInvoiceMoney(line.amount), right, y, { align: "right" })
    y += rowHeight - 10
    pdf.setDrawColor(...LINE).line(MARGIN, y, right, y)
    y += 16
  }

  // Totals.
  y = ensureSpace(y, 80)
  pdf.setFont("helvetica", "normal").setFontSize(11).setTextColor(...INK)
  pdf.text("Total", right - 140, y)
  pdf.setFont("helvetica", "bold")
  pdf.text(formatInvoiceMoney(invoice.total), right, y, { align: "right" })
  y += 30
  pdf.setFont("helvetica", "bold").setFontSize(8).setTextColor(...MUTED)
  pdf.text("BALANCE DUE", right, y, { align: "right" })
  y += 24
  pdf.setFont("helvetica", "bold").setFontSize(22).setTextColor(...INK)
  pdf.text(formatInvoiceMoney(invoiceBalanceDue(invoice)), right, y, { align: "right" })
  y += 34

  // Note to customer — usually how to pay.
  if (invoice.note && invoice.status !== "void") {
    pdf.setFont("helvetica", "normal").setFontSize(11)
    const wrapped: string[] = pdf.splitTextToSize(invoice.note, contentWidth - 28)
    const boxHeight = wrapped.length * 14 + 40
    y = ensureSpace(y, boxHeight)
    pdf.setFillColor(250, 250, 248).rect(MARGIN, y, contentWidth, boxHeight, "F")
    pdf.setFillColor(...accent).rect(MARGIN, y, 4, boxHeight, "F")
    pdf.setFont("helvetica", "bold").setFontSize(8).setTextColor(...MUTED)
    pdf.text(invoice.status === "paid" ? "NOTE" : "HOW TO PAY", MARGIN + 16, y + 18)
    pdf.setFont("helvetica", "normal").setFontSize(11).setTextColor(...INK)
    pdf.text(wrapped, MARGIN + 16, y + 34)
    y += boxHeight
  }

  if (invoice.status === "void") {
    pdf.setFont("helvetica", "bold").setFontSize(64).setTextColor(200, 200, 196)
    pdf.text("VOID", pageWidth / 2, pageHeight / 2, { align: "center", angle: 30 })
  }

  return pdf.output("blob")
}

export async function shareInvoicePdf(invoice: InvoiceType, settings: InvoiceSettings): Promise<void> {
  const blob = await buildInvoicePdf(invoice, settings)
  await sharePdfBlob(blob, invoiceFileName(invoice), `Invoice #${invoice.number}`)
}
