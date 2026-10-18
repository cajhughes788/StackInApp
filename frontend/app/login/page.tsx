// app/login/page.tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getAuthSafe } from "@/lib/firebase";
import { signInWithEmailAndPassword } from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Toaster } from "@/components/ui/toaster";
import { Capacitor } from "@capacitor/core";
import { detectNativeSignupCountryEligibility } from "@/lib/mobile/nativeSignupEligibility";

const STACKIN_WEBSITE_SIGNUP_URL =
    process.env.NEXT_PUBLIC_STACKIN_WEBSITE_SIGNUP_URL?.trim() ||
    "https://stackin-app.com/signup";

function getLoginErrorCopy(error: unknown) {
    if (error instanceof FirebaseError) {
        switch (error.code) {
            case "auth/invalid-credential":
            case "auth/user-not-found":
            case "auth/wrong-password":
                return {
                    title: "We couldn't log you in",
                    description: "That email or password doesn't match our records. Double-check both and try again.",
                };
            case "auth/invalid-email":
                return {
                    title: "Email looks off",
                    description: "Please enter a valid email address and try again.",
                };
            case "auth/user-disabled":
                return {
                    title: "This account is disabled",
                    description: "Please contact support if you think this was a mistake.",
                };
            case "auth/too-many-requests":
                return {
                    title: "Too many attempts",
                    description: "Please wait a few minutes before trying again.",
                };
            case "auth/network-request-failed":
                return {
                    title: "No connection",
                    description: "Check your internet connection and try again.",
                };
            default:
                return {
                    title: "Login failed",
                    description: "We couldn't log you in right now. Please try again in a moment.",
                };
        }
    }

    if (error instanceof Error && error.message.includes("Firebase Auth not initialized")) {
        return {
            title: "App still loading",
            description: "Login isn't ready yet. Give it a second, then try again.",
        };
    }

    return {
        title: "Login failed",
        description: "Something went wrong while logging in. Please try again.",
    };
}

function getSignupOpenErrorCopy(error: unknown) {
    if (error instanceof Error && error.message) {
        return {
            title: "Couldn't open sign-up",
            description: `We couldn't open the sign-up page. ${error.message}`,
        };
    }

    return {
        title: "Couldn't open sign-up",
        description: "We couldn't open the sign-up page right now. Please try again.",
    };
}

export default function LoginPage() {
    const router = useRouter();
    const { toast } = useToast();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [openingSignup, setOpeningSignup] = useState(false);
    const [showNativeHelp, setShowNativeHelp] = useState(false);
    const isNativeApp = Capacitor.isNativePlatform();
    const [nativeSignupAllowed, setNativeSignupAllowed] = useState(() => !isNativeApp);
    const showCreateAccount = !isNativeApp || nativeSignupAllowed;
    const showNativeWebsiteFirstMessage = isNativeApp && !nativeSignupAllowed;

    useEffect(() => {
        if (!isNativeApp) {
            setNativeSignupAllowed(true);
            return;
        }
        setNativeSignupAllowed(detectNativeSignupCountryEligibility());
    }, [isNativeApp]);

    const handleCreateAccount = async () => {
        if (isNativeApp) {
            // App Review 4: accounts are created in the app. Only the
            // subscription purchase links out to the default browser
            // (see app/welcome/page.tsx).
            router.push("/signup");
            return;
        }
        try {
            setOpeningSignup(true);
            window.open(STACKIN_WEBSITE_SIGNUP_URL, "_blank", "noopener,noreferrer");
        }
        catch (err: any) {
            const copy = getSignupOpenErrorCopy(err);
            toast({
                title: copy.title,
                description: copy.description,
                variant: "destructive",
            });
        }
        finally {
            setOpeningSignup(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email || !password)
            return;
        setLoading(true);
        try {
            const auth = getAuthSafe(); // ensure auth is defined
            if (!auth)
                throw new Error("Firebase Auth not initialized");
            await signInWithEmailAndPassword(auth, email, password);
            // Removed manual setUser block #1
            // setUser({
            //   uid: user.uid,
            //   email: user.email ?? null,
            //   phoneNumber: user.phoneNumber ?? null,
            // })
            // router.push("/home")
            // Removed manual setUser block #2
            // setUser({
            //   uid: user.uid,
            //   email: user.email ?? null,
            //   phoneNumber: user.phoneNumber ?? null,
            // })
            // Enter the protected app boundary and let it choose
            // between home, settings, or welcome.
            router.push("/app");
        }
        catch (err: any) {
            const copy = getLoginErrorCopy(err);
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
          <CardTitle className="text-2xl font-bold text-center">Welcome back</CardTitle>
          <CardDescription className="text-center">
            {isNativeApp
                ? showCreateAccount
                    ? "Sign in with your 521 email and password."
                    : "Sign in with your existing 521 email and password."
                : "Log in to access your account."}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required/>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input id="password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" required/>
                <button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute right-3 top-2.5 text-muted-foreground">
                  {showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Logging in..." : "Log In"}
            </Button>

            <div className="text-sm text-center mt-4">
              <button type="button" onClick={() => router.push("/forgot-password")} className="text-primary underline underline-offset-2 hover:opacity-80 transition">
                Forgot your password?
              </button>
            </div>

            {showCreateAccount ? (
              <div className="text-sm text-center mt-2">
                Need a 521 account?{" "}
                <button type="button" onClick={handleCreateAccount} disabled={openingSignup} className="text-primary underline underline-offset-2 hover:opacity-80 transition disabled:opacity-60">
                  {openingSignup ? "Opening..." : "Create Account"}
                </button>
              </div>
            ) : null}

            {showNativeWebsiteFirstMessage ? (
              <div className="text-center text-sm text-muted-foreground">
                Account creation in the app is currently available only in the U.S.
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 pt-2 text-sm">
              {isNativeApp ? (
                <button
                  type="button"
                  onClick={() => setShowNativeHelp(true)}
                  className="text-primary underline underline-offset-2 hover:opacity-80 transition"
                >
                  Need help?
                </button>
              ) : null}
              <Link href="/terms" className="text-primary underline underline-offset-2 hover:opacity-80 transition">
                Terms
              </Link>
              <Link href="/privacy" className="text-primary underline underline-offset-2 hover:opacity-80 transition">
                Privacy
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      <Dialog open={showNativeHelp} onOpenChange={setShowNativeHelp}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Need help signing in?</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 text-sm text-muted-foreground">
            <p>If you forgot your password, use the password reset link on the login screen.</p>
          </div>

          <div className="flex flex-col gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowNativeHelp(false);
                router.push("/forgot-password");
              }}
            >
              Reset Password
            </Button>
            <Button type="button" onClick={() => setShowNativeHelp(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>);
}
