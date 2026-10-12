"use client"

import StackInMark from "@/components/stackin-mark"

export type StackInLoaderWebProps = {
  className?: string
  label?: string
  showLabel?: boolean
  size?: number
  background?: string
  cardBackground?: string
  textColor?: string
}

export default function StackInLoaderWeb({
  className,
  label = "Loading 521...",
  showLabel = true,
  size = 260,
  background = "transparent",
  cardBackground = "#161B1E",
  textColor = "#C9C7C0",
}: StackInLoaderWebProps) {
  return (
    <div
      className={["flex w-full justify-center", className].filter(Boolean).join(" ")}
      style={{ background }}
    >
      <div
        className="relative mx-auto flex w-full max-w-fit flex-col items-center justify-center gap-4 rounded-[2rem] px-8 py-6 text-center"
        style={{ background: cardBackground }}
      >
        <StackInMark size={Math.round(size * 0.42)} animated label={label} />

        {showLabel ? (
          <p
            className="m-0 w-full max-w-[20rem] text-center text-sm font-medium leading-5 sm:max-w-[22rem]"
            style={{ color: textColor }}
          >
            {label}
          </p>
        ) : null}
      </div>
    </div>
  )
}
