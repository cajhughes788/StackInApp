"use client"

import { Capacitor } from "@capacitor/core"
import { X } from "lucide-react"
import { useRouter } from "next/navigation"

import TermsContent from "@/components/terms-content"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function TermsPage() {
  const router = useRouter()
  const isNativeApp = Capacitor.isNativePlatform()

  const handleClose = () => {
    if (window.history.length > 1) {
      router.back()
      return
    }

    router.push("/login")
  }

  return (
    <div className="mx-auto mt-4 max-w-3xl p-4 sm:mt-12">
      <Card className="relative rounded-2xl border shadow-lg">
        {isNativeApp ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-4 top-4 z-10"
            onClick={handleClose}
          >
            <X />
            <span className="sr-only">Close terms and conditions</span>
          </Button>
        ) : null}

        <CardHeader className={isNativeApp ? "pr-16" : undefined}>
          <CardTitle className="text-center text-2xl font-bold">
            Terms and Conditions
          </CardTitle>
        </CardHeader>

        <CardContent className="px-0 pb-0">
          <TermsContent
            onClose={isNativeApp ? handleClose : undefined}
            showCloseButton={isNativeApp}
          />
        </CardContent>
      </Card>
    </div>
  )
}
