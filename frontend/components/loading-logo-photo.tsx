"use client"

import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

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
  const assets = [
    "/images/aligned-hole-logo-mobile.webp",
    "/images/aligned-dollar-mobile.webp",
    "/images/aligned-coin-stack-mobile.webp",
    "/images/aligned-coin-mobile.webp",
  ]
  const height = (size * 650) / 1125.79
  const alignedArtX = -10
  const alignedArtY = -78
  const alignedArtWidth = 1146
  const alignedArtHeight = 680
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    const loadAsset = (src: string) =>
      new Promise<void>((resolve) => {
        const image = new window.Image()

        const finish = () => resolve()
        image.onload = () => {
          if ("decode" in image) {
            image.decode().then(finish).catch(finish)
            return
          }
          finish()
        }
        image.onerror = finish
        image.src = src

        if (image.complete) {
          if ("decode" in image) {
            image.decode().then(finish).catch(finish)
            return
          }
          finish()
        }
      })

    Promise.all(assets.map(loadAsset)).then(() => {
      if (!cancelled) {
        setIsReady(true)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div
      className={cn(
        "relative mx-auto flex w-full max-w-fit flex-col items-center gap-3 rounded-[2rem] bg-[#000000] px-6 py-6 text-center sm:px-8",
        className,
      )}
    >
      <div className="relative z-10 mx-auto flex items-center justify-center" style={{ width: size, height }}>
        {isReady ? (
          <svg
            viewBox="0 0 1125.79 518.89"
            width={size}
            height={height}
            role="img"
            aria-label={label}
            className="overflow-visible"
          >
            <defs>
              <filter id="stackin-photo-loader-soft-glow">
                <feDropShadow dx="0" dy="0" stdDeviation="10" floodColor="#7bff6a" floodOpacity="0.35" />
                <feDropShadow dx="0" dy="0" stdDeviation="20" floodColor="#59d72f" floodOpacity="0.18" />
              </filter>
              <filter id="stackin-photo-loader-gold-glow">
                <feDropShadow dx="0" dy="0" stdDeviation="3.5" floodColor="#fff2a8" floodOpacity="0.45" />
                <feDropShadow dx="0" dy="0" stdDeviation="8" floodColor="#f4c63d" floodOpacity="0.28" />
                <feDropShadow dx="0" dy="0" stdDeviation="14" floodColor="#a86a08" floodOpacity="0.16" />
              </filter>
            </defs>

            <g className="stackin-photo-loader-logo">
              <g className="stackin-photo-loader-base">
                <image
                  href={assets[0]}
                  x={alignedArtX}
                  y={alignedArtY}
                  width={alignedArtWidth}
                  height={alignedArtHeight}
                  preserveAspectRatio="none"
                />
              </g>

              <g className="stackin-photo-loader-dollar">
                <image
                  href={assets[1]}
                  x={alignedArtX}
                  y={alignedArtY}
                  width={alignedArtWidth}
                  height={alignedArtHeight}
                  preserveAspectRatio="none"
                />
              </g>

              <g className="stackin-photo-loader-coin-stack">
                <image
                  href={assets[2]}
                  x={alignedArtX}
                  y={alignedArtY}
                  width={alignedArtWidth}
                  height={alignedArtHeight}
                  preserveAspectRatio="none"
                />
              </g>

              <g className="stackin-photo-loader-coin stackin-photo-loader-coin-a">
                <image
                  href={assets[3]}
                  x={alignedArtX}
                  y={alignedArtY}
                  width={alignedArtWidth}
                  height={alignedArtHeight}
                  preserveAspectRatio="none"
                />
              </g>

              <g className="stackin-photo-loader-coin stackin-photo-loader-coin-b">
                <image
                  href={assets[3]}
                  x={alignedArtX}
                  y={alignedArtY}
                  width={alignedArtWidth}
                  height={alignedArtHeight}
                  preserveAspectRatio="none"
                />
              </g>

              <g className="stackin-photo-loader-coin stackin-photo-loader-coin-c">
                <image
                  href={assets[3]}
                  x={alignedArtX}
                  y={alignedArtY}
                  width={alignedArtWidth}
                  height={alignedArtHeight}
                  preserveAspectRatio="none"
                />
              </g>
            </g>
          </svg>
        ) : (
          <div className="h-10 w-10 rounded-full border-2 border-[#486b18] border-t-[#c9ff63] animate-spin" aria-hidden="true" />
        )}
      </div>

      {showLabel ? (
        <p className="relative z-10 mx-auto w-full max-w-[20rem] text-center text-sm font-medium leading-5 text-[#c9ff63] drop-shadow-[0_0_10px_rgba(133,255,77,0.22)] sm:max-w-[22rem]">
          {label}
        </p>
      ) : null}
    </div>
  )
}
