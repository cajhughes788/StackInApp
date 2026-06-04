// /lib/network/status.ts
"use client"

import { Capacitor } from "@capacitor/core";
import type { NetworkStatus } from "@capacitor/network";
import { debugLog } from "@/lib/debugLoop";

let isOnline = true;
const listeners = new Set<(online: boolean) => void>();
let initialized = false;

function emit(online: boolean) {
  if (isOnline === online) {
    return;
  }
  isOnline = online;
  for (const cb of listeners) cb(online);
}

export function getIsOnline() {
  return isOnline;
}

export function onNetworkChange(cb: (online: boolean) => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function init() {
  if (initialized) {
    return;
  }
  initialized = true;

  if (typeof window !== "undefined") {
    isOnline = navigator.onLine ?? true;

    window.addEventListener("online", () => emit(true));
    window.addEventListener("offline", () => emit(false));
  }

  if (Capacitor.isNativePlatform()) {
    import("@capacitor/network").then(({ Network }) => {
      Network.getStatus().then((status: NetworkStatus) => {
        const navOnline = navigator.onLine ?? true;

        if (status.connected) {
          // Capacitor confirms online — accept it.
          debugLog("network-status", "startup_reading", {
            capacitorConnected: true,
            navigatorOnLine: navOnline,
            action: "emit_true",
          });
          emit(true);
        } else if (!navOnline) {
          // Both Capacitor and the browser agree the device is offline — accept it.
          debugLog("network-status", "startup_reading", {
            capacitorConnected: false,
            navigatorOnLine: false,
            action: "emit_false",
          });
          emit(false);
        } else {
          // Capacitor says offline but navigator.onLine says online.
          // Known transient false at native startup — don't emit, keep isOnline
          // at its navigator.onLine value and let networkStatusChange carry any
          // genuine offline transition.
          debugLog("network-status", "startup_reading", {
            capacitorConnected: false,
            navigatorOnLine: true,
            action: "skipped_transient_false",
            isOnlineUnchanged: isOnline,
          });
        }

        // Schedule a single re-check as a backstop in case the native network
        // stack needs time to stabilize after a true offline start.
        if (!status.connected && navOnline) {
          setTimeout(() => {
            Network.getStatus().then((s: NetworkStatus) => {
              const navOnline2 = navigator.onLine ?? true;
              if (!s.connected && !navOnline2) {
                debugLog("network-status", "startup_recheck", {
                  capacitorConnected: false,
                  navigatorOnLine: false,
                  action: "emit_false",
                });
                emit(false);
              } else if (s.connected) {
                debugLog("network-status", "startup_recheck", {
                  capacitorConnected: true,
                  navigatorOnLine: navOnline2,
                  action: "emit_true",
                });
                emit(true);
              } else {
                debugLog("network-status", "startup_recheck", {
                  capacitorConnected: false,
                  navigatorOnLine: true,
                  action: "skipped_still_transient",
                });
              }
            });
          }, 3000);
        }
      });

      Network.addListener("networkStatusChange", (status: NetworkStatus) => {
        debugLog("network-status", "network_change", {
          capacitorConnected: status.connected,
          navigatorOnLine: navigator.onLine ?? true,
          currentIsOnline: isOnline,
        });
        emit(status.connected);
      });
    });
  }
}

init();
