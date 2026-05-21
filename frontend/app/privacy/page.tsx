"use client"

import { Capacitor } from "@capacitor/core"
import { X } from "lucide-react"
import { useRouter } from "next/navigation"

import PrivacyPolicyContent from "@/components/privacy-policy-content"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export default function PrivacyPage() {
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
            <span className="sr-only">Close privacy policy</span>
          </Button>
        ) : null}

        <CardContent className={isNativeApp ? "px-6 pb-8 pt-14 sm:px-8" : "px-6 py-8 sm:px-8"}>
          <PrivacyPolicyContent />
        </CardContent>

        {isNativeApp ? (
          <div className="border-t px-6 py-4 sm:px-8">
            <Button type="button" className="w-full" onClick={handleClose}>
              Done
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  )
}
