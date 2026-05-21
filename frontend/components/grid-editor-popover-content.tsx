"use client";

import type { ComponentProps } from "react";
import { useEffect, useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import type * as PopoverPrimitive from "@radix-ui/react-popover";
import { PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function isAndroidNativePlatform() {
    return typeof window !== "undefined" &&
        Capacitor.isNativePlatform() &&
        Capacitor.getPlatform() === "android";
}

function readViewportMetrics() {
    if (typeof window === "undefined") {
        return {
            keyboardInset: 0,
            viewportHeight: 0,
        };
    }

    const viewport = window.visualViewport;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const offsetTop = viewport?.offsetTop ?? 0;
    const keyboardInset = Math.max(0, window.innerHeight - viewportHeight - offsetTop);

    return {
        keyboardInset,
        viewportHeight,
    };
}

export function GridEditorPopoverContent({
    className,
    style,
    side = "top",
    align = "end",
    sideOffset = 4,
    ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
    const [viewportMetrics, setViewportMetrics] = useState(() => readViewportMetrics());
    const useAndroidKeyboardSafeLayout = useMemo(() => isAndroidNativePlatform(), []);

    useEffect(() => {
        if (!useAndroidKeyboardSafeLayout || typeof window === "undefined") {
            return;
        }

        const updateViewportMetrics = () => {
            setViewportMetrics(readViewportMetrics());
        };

        updateViewportMetrics();
        window.addEventListener("resize", updateViewportMetrics);
        window.visualViewport?.addEventListener("resize", updateViewportMetrics);
        window.visualViewport?.addEventListener("scroll", updateViewportMetrics);

        return () => {
            window.removeEventListener("resize", updateViewportMetrics);
            window.visualViewport?.removeEventListener("resize", updateViewportMetrics);
            window.visualViewport?.removeEventListener("scroll", updateViewportMetrics);
        };
    }, [useAndroidKeyboardSafeLayout]);

    const androidStyle = useAndroidKeyboardSafeLayout
        ? {
            position: "fixed" as const,
            left: "50%",
            top: "auto",
            right: "auto",
            bottom: `${viewportMetrics.keyboardInset + 12}px`,
            transform: "translateX(-50%)",
            width: "min(calc(100vw - 1rem), 28rem)",
            maxHeight: `${Math.max(180, viewportMetrics.viewportHeight - 24)}px`,
        }
        : null;

    return (
        <PopoverContent
            side={side}
            align={align}
            sideOffset={sideOffset}
            className={cn(
                useAndroidKeyboardSafeLayout && "overflow-y-auto overscroll-contain",
                className
            )}
            style={{
                ...style,
                ...androidStyle,
            }}
            {...props}
        />
    );
}
