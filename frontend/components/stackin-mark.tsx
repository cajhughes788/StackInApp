type StackInMarkProps = {
  size?: number
  animated?: boolean
  label?: string
  className?: string
}

// The StackIn app icon: three ledger books on a navy tile. Paths mirror
// public/brand/stackin-icon.svg. When animated, the books settle onto the
// stack bottom-up (see .stackin-mark-book in app/globals.css).
export default function StackInMark({ size = 64, animated = false, label = "StackIn", className }: StackInMarkProps) {
  const book = (position: "top" | "middle" | "bottom") =>
    animated ? `stackin-mark-book stackin-mark-book-${position}` : undefined

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={label}
      className={className}
    >
      <rect width="64" height="64" rx="14" fill="#0E1A2B" />
      <path
        className={book("top")}
        d="M16.4 16.8H18.9V26.2H16.4A2.6 2.6 0 0 1 13.8 23.6V19.4A2.6 2.6 0 0 1 16.4 16.8ZM20.2 16.8H49.6A2.6 2.6 0 0 1 52.2 19.4V23.6A2.6 2.6 0 0 1 49.6 26.2H20.2V16.8Z"
        fill="#2BAE8A"
      />
      <path
        className={book("middle")}
        d="M13.5 26.8H16V36.2H13.5A2.6 2.6 0 0 1 10.9 33.6V29.4A2.6 2.6 0 0 1 13.5 26.8ZM17.3 26.8H45.7A2.6 2.6 0 0 1 48.3 29.4V33.6A2.6 2.6 0 0 1 45.7 36.2H17.3V26.8Z"
        fill="#C5CCD5"
      />
      <path
        className={book("bottom")}
        d="M16.1 36.8H17.8V46.2H16.1A2.6 2.6 0 0 1 13.5 43.6V39.4A2.6 2.6 0 0 1 16.1 36.8ZM19.1 36.8H49A2.6 2.6 0 0 1 51.6 39.4V43.6A2.6 2.6 0 0 1 49 46.2H19.1V36.8Z"
        fill="#FFFFFF"
      />
    </svg>
  )
}
