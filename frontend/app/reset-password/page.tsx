"use client"
export const dynamic = "force-dynamic"
export const fetchCache = "force-no-store"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { getAuthSafe } from "@/lib/firebase"
import {
  verifyPasswordResetCode,
  confirmPasswordReset,
} from "firebase/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { Eye, EyeOff } from "lucide-react"
import StackInMark from "@/components/stackin-mark"

export default function ResetPasswordPage() {
  const router = useRouter()
  const { toast } = useToast()

  const [oobCode, setOobCode] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [isVerifying, setIsVerifying] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

useEffect(() => {
  // ⭐ Read oobCode manually from the real URL (browser-only, never SSR)
  const params = new URLSearchParams(window.location.search)
  const code = params.get("oobCode")

  if (!code) {
    router.push("/forgot-password")
    return
  }

  setOobCode(code)

  const auth = getAuthSafe()
  if (!auth) {
    toast({
      title: "Auth unavailable",
      description: "Please refresh the page and try again.",
      variant: "destructive",
    })
    router.push("/forgot-password")
    return
  }

  verifyPasswordResetCode(auth, code)
    .then((email) => setEmail(email))
    .catch(() => {
      toast({
        title: "Invalid or expired link",
        description: "Please request a new password reset link.",
        variant: "destructive",
      })
      router.push("/forgot-password")
    })
    .finally(() => setIsVerifying(false))
}, [router, toast])


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!oobCode || !newPassword || !confirmPassword) return

    if (newPassword !== confirmPassword) {
      toast({
        title: "Passwords do not match",
        description: "Please re-enter your passwords.",
        variant: "destructive",
      })
      return
    }

    const auth = getAuthSafe() // ✅ safe guard here too
    if (!auth) {
      toast({
        title: "Auth unavailable",
        description: "Please refresh the page and try again.",
        variant: "destructive",
      })
      return
    }

    try {
      setIsSubmitting(true)
      await confirmPasswordReset(auth, oobCode, newPassword)
      router.push("/login")
    } catch (err: any) {
      toast({
        title: "Error resetting password",
        description: err.message || "Something went wrong. Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isVerifying)
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background p-4">
        <StackInMark size={56} />
        <p className="text-sm text-muted-foreground">
          Verifying your reset link...
        </p>
      </div>
    )

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 p-4">
      <StackInMark size={56} />
      <Card className="w-full max-w-md">
        <CardHeader className="gap-2 text-center">
          <CardTitle className="text-2xl font-semibold">
            Choose a new password
          </CardTitle>
          <CardDescription className="text-pretty">
            {email ? (
              <>
                For <span className="font-medium text-foreground">{email}</span>
              </>
            ) : (
              "Enter your new password below"
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* New Password */}
            <div className="space-y-2">
              <Label htmlFor="newPassword">New password</Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  className="h-11 rounded-xl pr-11"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  className="h-11 rounded-xl pr-11"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground"
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <Button type="submit" className="h-11 w-full rounded-full" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save new password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
