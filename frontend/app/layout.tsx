import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { PWAInstallPrompt } from "@/components/pwa-install-prompt"
import { AccountAuthorityProvider } from "@/contexts/account-authority-context"
import { AuthProvider } from "@/contexts/auth-context"
import { ThemeProvider } from "@/components/theme-provider"
import { PointerEventsGuard } from "@/components/pointer-events-guard"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
})

const metadataBase = new URL("https://stackin-app.com")

export const metadata: Metadata = {
  metadataBase,
  title: "StackIn",
  description: "Track your income across pay periods",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    shortcut: ["/icon-192.png"],
  },
  openGraph: {
    title: "StackIn",
    description: "Track your income across pay periods",
    url: metadataBase,
    images: [
      {
        url: "/stackin-share.jpeg",
        width: 892,
        height: 396,
        alt: "StackIn logo artwork",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "StackIn",
    description: "Track your income across pay periods",
    images: ["/stackin-share.jpeg"],
  },
}

export const viewport = {
  themeColor: "#0d1b2a",
  viewportFit: "cover" as const,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* head content */}
      </head>

      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="stackin-theme">
          <AuthProvider>
            <AccountAuthorityProvider>
              <PointerEventsGuard />
              {children}
              <PWAInstallPrompt />
            </AccountAuthorityProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
