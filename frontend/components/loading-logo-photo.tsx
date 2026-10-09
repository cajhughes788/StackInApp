"use client"

import StackInLoaderWeb from "@/components/stackin-loader-web"

type LoadingLogoPhotoProps = {
  className?: string
  label?: string
  showLabel?: boolean
  size?: number
}

export default function LoadingLogoPhoto({
  className,
  label = "Loading StackIn...",
  showLabel = true,
  size = 260,
}: LoadingLogoPhotoProps) {
  return <StackInLoaderWeb className={className} label={label} showLabel={showLabel} size={size} />
}
