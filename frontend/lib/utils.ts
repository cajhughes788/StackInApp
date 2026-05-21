import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const isBrowser = typeof window !== "undefined";

export const noop = () => {};

export const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
