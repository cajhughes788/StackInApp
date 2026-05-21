"use client"

import LoadingLogoPhoto from "@/components/loading-logo-photo"
import { cn } from "@/lib/utils"

type AppLoaderProps = {
  className?: string
  label?: string
  fullscreen?: boolean
  size?: number
}

export default function AppLoader({
  className,
  label = "Loading StackIn...",
  fullscreen = true,
  size = 280,
}: AppLoaderProps) {
  return (
    <div
      className={cn(
        fullscreen
          ? "min-h-screen bg-[#020402] px-6 py-10"
          : "min-h-[16rem] bg-transparent px-4 py-6",
        "flex items-center justify-center",
        className,
      )}
    >
      <LoadingLogoPhoto label={label} size={size} />
    </div>
  )
}
