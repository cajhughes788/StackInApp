"use client"

import { useEffect, useState } from "react"

export type StackInLoaderWebProps = {
  className?: string
  label?: string
  showLabel?: boolean
  size?: number
  background?: string
  cardBackground?: string
  textColor?: string
  assets?: {
    base?: string
    dollar?: string
    coinStack?: string
    coin?: string
  }
}

const DEFAULT_ASSETS = {
  base: "/images/aligned-hole-logo-mobile.png",
  dollar: "/images/aligned-dollar-mobile.png",
  coinStack: "/images/aligned-coin-stack-mobile.png",
  coin: "/images/aligned-coin-mobile.png",
}

const WRAPPER_STYLE = `
.stackin-loader-web__shell {
  display: inline-flex;
  justify-content: center;
  width: 100%;
}

.stackin-loader-web {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border-radius: 2rem;
  padding: 1.5rem 2rem;
  margin: 0 auto;
  width: 100%;
  max-width: fit-content;
  text-align: center;
}

.stackin-loader-web__art {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto;
}

.stackin-loader-web__svg {
  overflow: visible;
}

.stackin-loader-web__label {
  position: relative;
  z-index: 1;
  margin: 0;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.25rem;
  width: 100%;
  max-width: 20rem;
  text-align: center;
}

@media (min-width: 640px) {
  .stackin-loader-web {
    padding: 1.5rem 2rem;
  }

  .stackin-loader-web__label {
    max-width: 22rem;
  }
}

.stackin-loader-web__fallback {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 9999px;
  border: 2px solid #486b18;
  border-top-color: #c9ff63;
  animation: stackin-loader-web-spin 1s linear infinite;
}

.stackin-loader-web__dollar {
  transform-box: view-box;
  transform-origin: 23% 58%;
  animation: stackin-loader-web-pulse 0.9s linear infinite;
}

.stackin-loader-web__coin-stack {
  transform-box: view-box;
  transform-origin: 80% 67%;
  animation: stackin-loader-web-stack-bounce 1.8s ease-in-out infinite;
}

.stackin-loader-web__coin {
  opacity: 0;
  transform-box: view-box;
  transform-origin: 80% 24%;
}

.stackin-loader-web__coin--a {
  animation: stackin-loader-web-coin-drop 1.8s linear infinite;
}

.stackin-loader-web__coin--b {
  animation: stackin-loader-web-coin-drop 1.8s linear infinite 0.6s;
}

.stackin-loader-web__coin--c {
  animation: stackin-loader-web-coin-drop 1.8s linear infinite 1.2s;
}

@keyframes stackin-loader-web-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes stackin-loader-web-pulse {
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.14);
  }
  100% {
    transform: scale(1);
  }
}

@keyframes stackin-loader-web-coin-drop {
  0% {
    opacity: 0;
    transform: translateY(-132px);
  }
  6% {
    opacity: 1;
    transform: translateY(-132px);
  }
  39% {
    opacity: 1;
    transform: translateY(72px);
  }
  40% {
    opacity: 0;
    transform: translateY(72px);
  }
  100% {
    opacity: 0;
    transform: translateY(72px);
  }
}

@keyframes stackin-loader-web-stack-bounce {
  0% {
    transform: translateY(0) scale(1);
  }
  6% {
    transform: translateY(0) scale(1);
  }
  9% {
    transform: translateY(4px) scale(1.02, 0.97);
  }
  15% {
    transform: translateY(-1px) scale(0.995, 1.015);
  }
  22% {
    transform: translateY(0) scale(1);
  }
  39% {
    transform: translateY(0) scale(1);
  }
  42% {
    transform: translateY(4px) scale(1.02, 0.97);
  }
  48% {
    transform: translateY(-1px) scale(0.995, 1.015);
  }
  55% {
    transform: translateY(0) scale(1);
  }
  73% {
    transform: translateY(0) scale(1);
  }
  76% {
    transform: translateY(4px) scale(1.02, 0.97);
  }
  82% {
    transform: translateY(-1px) scale(0.995, 1.015);
  }
  89%,
  100% {
    transform: translateY(0) scale(1);
  }
}
`

export default function StackInLoaderWeb({
  className,
  label = "Loading StackIn...",
  showLabel = true,
  size = 260,
  background = "transparent",
  cardBackground = "#000000",
  textColor = "#c9ff63",
  assets,
}: StackInLoaderWebProps) {
  const mergedAssets = {
    ...DEFAULT_ASSETS,
    ...assets,
  }
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

    Promise.all(Object.values(mergedAssets).map(loadAsset)).then(() => {
      if (!cancelled) {
        setIsReady(true)
      }
    })

    return () => {
      cancelled = true
    }
  }, [mergedAssets.base, mergedAssets.coin, mergedAssets.coinStack, mergedAssets.dollar])

  return (
    <div
      className={["stackin-loader-web__shell", className].filter(Boolean).join(" ")}
      style={{ background }}
    >
      <style>{WRAPPER_STYLE}</style>

      <div
        className="stackin-loader-web"
        style={{ background: cardBackground }}
      >
        <div className="stackin-loader-web__art" style={{ width: size, height }}>
          {isReady ? (
            <svg
              viewBox="0 0 1125.79 518.89"
              width={size}
              height={height}
              role="img"
              aria-label={label}
              className="stackin-loader-web__svg"
            >
              <g>
                <g>
                  <image
                    href={mergedAssets.base}
                    x={alignedArtX}
                    y={alignedArtY}
                    width={alignedArtWidth}
                    height={alignedArtHeight}
                    preserveAspectRatio="none"
                  />
                </g>

                <g className="stackin-loader-web__dollar">
                  <image
                    href={mergedAssets.dollar}
                    x={alignedArtX}
                    y={alignedArtY}
                    width={alignedArtWidth}
                    height={alignedArtHeight}
                    preserveAspectRatio="none"
                  />
                </g>

                <g className="stackin-loader-web__coin-stack">
                  <image
                    href={mergedAssets.coinStack}
                    x={alignedArtX}
                    y={alignedArtY}
                    width={alignedArtWidth}
                    height={alignedArtHeight}
                    preserveAspectRatio="none"
                  />
                </g>

                <g className="stackin-loader-web__coin stackin-loader-web__coin--a">
                  <image
                    href={mergedAssets.coin}
                    x={alignedArtX}
                    y={alignedArtY}
                    width={alignedArtWidth}
                    height={alignedArtHeight}
                    preserveAspectRatio="none"
                  />
                </g>

                <g className="stackin-loader-web__coin stackin-loader-web__coin--b">
                  <image
                    href={mergedAssets.coin}
                    x={alignedArtX}
                    y={alignedArtY}
                    width={alignedArtWidth}
                    height={alignedArtHeight}
                    preserveAspectRatio="none"
                  />
                </g>

                <g className="stackin-loader-web__coin stackin-loader-web__coin--c">
                  <image
                    href={mergedAssets.coin}
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
            <div className="stackin-loader-web__fallback" aria-hidden="true" />
          )}
        </div>

        {showLabel ? (
          <p
            className="stackin-loader-web__label"
            style={{
              color: textColor,
              textShadow: "0 0 10px rgba(133,255,77,0.22)",
            }}
          >
            {label}
          </p>
        ) : null}
      </div>
    </div>
  )
}
