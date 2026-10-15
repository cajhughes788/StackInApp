"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { FirebaseError } from "firebase/app"
import { sendPasswordResetEmail } from "firebase/auth"
import { getAuthSafe } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import StackInMark from "@/components/stackin-mark"

export default function ForgotPasswordPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [email, setEmail] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [redirecting, setRedirecting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return

    const auth = getAuthSafe() // ✅ safely grab auth instance
    if (!auth) {
      toast({
        title: "Auth unavailable",
        description: "Please refresh the page and try again.",
        variant: "destructive",
      })
      return
    }

    const showSentAndRedirect = () => {
      toast({
        title: "Password Reset Email Sent",
        description: `If an account exists for ${email.trim()}, you'll receive a reset link shortly.`,
      })
      setEmail("")
      setRedirecting(true)
      setTimeout(() => {
        router.push("/login")
      }, 3000)
    }

    try {
      setIsSending(true)
      await sendPasswordResetEmail(auth, email.trim())
      showSentAndRedirect()
    } catch (err) {
      // Deliberately identical to the success path for every error except a
      // malformed email — anything else (including auth/user-not-found,
      // which Firebase can still throw here depending on the project's
      // email-enumeration-protection setting) must never distinguish "no
      // account" from a real failure, or this becomes an oracle for
      // checking who has a 521 account by email address.
      if (err instanceof FirebaseError && err.code === "auth/invalid-email") {
        toast({
          title: "Email looks off",
          description: "Please enter a valid email address and try again.",
          variant: "destructive",
        })
      } else {
        showSentAndRedirect()
      }
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 p-4">
      <StackInMark size={56} />
      <Card className="w-full max-w-md">
        <CardHeader className="gap-2 text-center">
          <CardTitle className="text-2xl font-semibold">
            Reset your password
          </CardTitle>
          <CardDescription className="text-pretty">
            Enter your email and we'll send you a link to choose a new password.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="h-11 rounded-xl"
                required
                disabled={isSending || redirecting}
              />
            </div>

            <Button
              type="submit"
              className="h-11 w-full rounded-full"
              disabled={isSending || redirecting}
            >
              {isSending ? "Sending..." : redirecting ? "Sent!" : "Send reset link"}
            </Button>

            {redirecting && (
              <p className="text-center text-sm text-muted-foreground">
                Redirecting to login...
              </p>
            )}

            <p className="rounded-xl bg-muted px-4 py-3 text-center text-xs text-muted-foreground text-pretty">
              Don't see it within a few minutes? Check your spam or junk folder.
            </p>

            <div className="text-sm text-center text-muted-foreground">
              Remember your password?{" "}
              <button
                type="button"
                onClick={() => router.push("/login")}
                className="font-medium text-primary hover:opacity-80 transition"
              >
                Back to login
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
