// /hooks/use-mobile.ts
"use client"

import { useState, useEffect } from "react";

/**
 * useIsMobile()
 * 
 * Detects whether the viewport is mobile-sized or running on a native platform.
 * - Safe for SSR (no window references during render).
 * - Automatically detects Capacitor environment.
 * - Recomputes on resize/orientation change.
 */

const MOBILE_BREAKPOINT = 768;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // Avoid SSR errors
    if (typeof window === "undefined") return;

    const checkMobile = () => {
      const isNative = !!(window as any).Capacitor;
      const isSmallScreen = window.innerWidth < MOBILE_BREAKPOINT;
      setIsMobile(isNative || isSmallScreen);
    };

    checkMobile(); // initial
    window.addEventListener("resize", checkMobile);
    window.addEventListener("orientationchange", checkMobile);

    return () => {
      window.removeEventListener("resize", checkMobile);
      window.removeEventListener("orientationchange", checkMobile);
    };
  }, []);

  return isMobile;
}

