// /lib/network/status.ts
"use client"

import { Capacitor } from "@capacitor/core";
import type { NetworkStatus } from "@capacitor/network";

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
        isOnline = status.connected;
      });

      Network.addListener(
        "networkStatusChange",
        (status: NetworkStatus) => emit(status.connected)
      );
    });
  }
}

init();
