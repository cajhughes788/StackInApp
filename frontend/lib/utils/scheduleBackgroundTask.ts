"use client";
type BackgroundTask = () => void | Promise<void>;
type IdleWindow = Window & {
    requestIdleCallback?: (callback: () => void, options?: {
        timeout: number;
    }) => number;
    cancelIdleCallback?: (handle: number) => void;
};
/**
 * Run non-critical work after the app has had a chance to paint.
 * We prefer requestIdleCallback where available and fall back to a short timeout.
 */
export function scheduleBackgroundTask(task: BackgroundTask, options: {
    timeoutMs?: number;
    delayMs?: number;
} = {}): () => void {
    if (typeof window === "undefined")
        return () => { };
    const idleWindow = window as IdleWindow;
    const timeoutMs = options.timeoutMs ?? 1500;
    const delayMs = options.delayMs ?? 250;
    let cancelled = false;
    let timeoutHandle: number | null = null;
    let idleHandle: number | null = null;
    const runTask = () => {
        if (cancelled)
            return;
        void Promise.resolve(task()).catch((error) => {
        });
    };
    if (typeof idleWindow.requestIdleCallback === "function") {
        idleHandle = idleWindow.requestIdleCallback(runTask, { timeout: timeoutMs });
    }
    else {
        timeoutHandle = window.setTimeout(runTask, delayMs);
    }
    return () => {
        cancelled = true;
        if (idleHandle != null && typeof idleWindow.cancelIdleCallback === "function") {
            idleWindow.cancelIdleCallback(idleHandle);
        }
        if (timeoutHandle != null) {
            window.clearTimeout(timeoutHandle);
        }
    };
}
