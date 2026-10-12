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
  title: "521",
  description: "Track your income across pay periods",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/favicon.ico"],
  },
  openGraph: {
    title: "521",
    description: "Track your income across pay periods",
    url: metadataBase,
    images: [
      {
        url: "/521-share.png",
        width: 1200,
        height: 630,
        alt: "521 logo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "521",
    description: "Track your income across pay periods",
    images: ["/521-share.png"],
  },
}

export const viewport = {
  themeColor: "#161B1E",
  viewportFit: "cover" as const,
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* head content */}
      </head>

      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} storageKey="stackin-theme">
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
