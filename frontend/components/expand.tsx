"use client"

import type { ReactNode } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"

// Animates a section opening and closing (height + fade), the same easing the
// earnings page uses. Renders nothing while closed, exactly like a plain
// `open ? … : null`, and skips the motion when the device asks for less.
export default function Expand({
  open,
  id,
  className,
  children,
}: {
  open: boolean
  id?: string
  className?: string
  children: ReactNode
}) {
  const reduceMotion = useReducedMotion()
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="expand"
          id={id}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          <div className={className}>{children}</div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
