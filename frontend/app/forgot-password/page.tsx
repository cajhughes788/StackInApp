"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { sendPasswordResetEmail } from "firebase/auth"
import { getAuthSafe } from "@/lib/firebase" 
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"

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

    try {
      setIsSending(true)
      await sendPasswordResetEmail(auth, email.trim())

      toast({
        title: "Password Reset Email Sent",
        description: `If an account exists for ${email.trim()}, you'll receive a reset link shortly.`,
      })

      setEmail("")
      setRedirecting(true)

      // Auto redirect after 3 seconds
      setTimeout(() => {
        router.push("/login")
      }, 3000)
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to send reset email",
        variant: "destructive",
      })
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="min-h-screen bg-secondary/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center">
            Reset your password
          </CardTitle>
          <CardDescription className="text-center text-pretty">
            Enter your email address below and we'll send you a reset link.
          </CardDescription>

          <p className="text-xs text-center text-muted-foreground mt-2">
            If you don't see the email within a few minutes, please check your
            <span className="font-medium"> spam</span> or{" "}
            <span className="font-medium">junk</span> folder.
          </p>
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
                required
                disabled={isSending || redirecting}
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isSending || redirecting}
            >
              {isSending ? "Sending..." : redirecting ? "Sent!" : "Send Reset Link"}
            </Button>

            {redirecting && (
              <p className="text-center text-sm text-muted-foreground mt-2">
                Redirecting to login...
              </p>
            )}

            <div className="text-sm text-center mt-4">
              Remember your password?{" "}
              <button
                type="button"
                onClick={() => router.push("/login")}
                className="text-primary underline underline-offset-2 hover:opacity-80 transition"
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
