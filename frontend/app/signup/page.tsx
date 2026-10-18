// app/signup/page.tsx
// In-app account creation (App Review Guideline 4). Mirrors the website's
// signup form: the account and legal consent are created here, and the
// subscription is chosen afterwards on /welcome.
"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Toaster } from "@/components/ui/toaster";
import { getAuthSafe } from "@/lib/firebase";
import { API_ENDPOINTS, apiFetch } from "@/lib/api";

// Must match the versions accepted by backend/functions/src/routes/signup.ts.
const LEGAL_CONSENT_VERSION = "2026-04-27";
const LEGAL_TERMS_VERSION = "2026-04-27";
const LEGAL_PRIVACY_VERSION = "2026-09-06";

function getSignupErrorCopy(error: unknown) {
    if (error instanceof FirebaseError) {
        switch (error.code) {
            case "auth/email-already-in-use":
                return {
                    title: "Account already exists",
                    description: "There's already a 521 account with that email. Try logging in instead.",
                };
            case "auth/invalid-email":
                return {
                    title: "Email looks off",
                    description: "Please enter a valid email address and try again.",
                };
            case "auth/weak-password":
                return {
                    title: "Password too short",
                    description: "Use at least 6 characters for your password.",
                };
            case "auth/network-request-failed":
                return {
                    title: "No connection",
                    description: "Check your internet connection and try again.",
                };
            case "auth/too-many-requests":
                return {
                    title: "Too many attempts",
                    description: "Please wait a few minutes before trying again.",
                };
        }
    }
    return {
        title: "Couldn't create your account",
        description: "Something went wrong while creating your account. Please try again.",
    };
}

export default function SignupPage() {
    const router = useRouter();
    const { toast } = useToast();
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [agreed, setAgreed] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password !== confirmPassword) {
            toast({
                title: "Passwords don't match",
                description: "Re-enter your password so both fields match.",
                variant: "destructive",
            });
            return;
        }
        if (!agreed) {
            toast({
                title: "Agreement required",
                description: "Please agree to the Terms and Conditions and Privacy Policy to continue.",
                variant: "destructive",
            });
            return;
        }
        setLoading(true);
        try {
            const auth = getAuthSafe();
            if (!auth)
                throw new Error("Firebase Auth not initialized");
            const trimmedEmail = email.trim();
            // A retry after the signup call failed reuses the account that
            // was already created instead of hitting email-already-in-use.
            const existingUser = auth.currentUser;
            const user = existingUser && existingUser.email?.toLowerCase() === trimmedEmail.toLowerCase()
                ? existingUser
                : (await createUserWithEmailAndPassword(auth, trimmedEmail, password)).user;
            const idToken = await user.getIdToken();
            await apiFetch(API_ENDPOINTS.user.signup, {
                method: "POST",
                body: JSON.stringify({
                    idToken,
                    email: trimmedEmail,
                    phone: phone.trim() || undefined,
                    signup_platform: "ios",
                    legalConsent: {
                        version: LEGAL_CONSENT_VERSION,
                        termsVersion: LEGAL_TERMS_VERSION,
                        privacyVersion: LEGAL_PRIVACY_VERSION,
                        acceptedAt: new Date().toISOString(),
                        userAgent: navigator.userAgent || "unknown",
                        source: "ios-app",
                    },
                }),
            });
            // The protected app sends a new account without a workspace to
            // /welcome, where the plan is chosen.
            router.push("/app");
        }
        catch (err: any) {
            const copy = getSignupErrorCopy(err);
            toast({
                title: copy.title,
                description: copy.description,
                variant: "destructive",
            });
        }
        finally {
            setLoading(false);
        }
    };

    return (<div className="min-h-screen bg-secondary/30 flex items-center justify-center p-4">
      <Toaster viewportClassName="left-1/2 top-1/2 right-auto bottom-auto w-[calc(100%-2rem)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 flex-col p-0 sm:left-1/2 sm:top-1/2 sm:right-auto sm:bottom-auto sm:w-[420px] sm:max-w-[420px] sm:-translate-x-1/2 sm:-translate-y-1/2" />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center">Create your account</CardTitle>
          <CardDescription className="text-center">
            One account for all your income. You'll choose a plan next.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required/>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone (optional)</Label>
              <Input id="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567"/>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input id="password" type={showPassword ? "text" : "password"} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Create a password" required/>
                <button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute right-3 top-2.5 text-muted-foreground">
                  {showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <div className="relative">
                <Input id="confirm-password" type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter your password" required/>
                <button type="button" onClick={() => setShowConfirmPassword((current) => !current)} className="absolute right-3 top-2.5 text-muted-foreground">
                  {showConfirmPassword ? <EyeOff size={18}/> : <Eye size={18}/>}
                </button>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-md border border-border p-4 text-sm">
              <Checkbox id="agree" checked={agreed} onCheckedChange={(checked) => setAgreed(checked === true)} className="mt-0.5"/>
              <label htmlFor="agree" className="leading-relaxed">
                I have read and agree to the{" "}
                <Link href="/terms" className="text-primary underline underline-offset-2">Terms and Conditions</Link>
                {" "}and{" "}
                <Link href="/privacy" className="text-primary underline underline-offset-2">Privacy Policy</Link>.
              </label>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Creating account..." : "Continue"}
            </Button>

            <div className="text-sm text-center mt-4">
              Already have an account?{" "}
              <Link href="/login" className="text-primary underline underline-offset-2 hover:opacity-80 transition">
                Log in
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>);
}
