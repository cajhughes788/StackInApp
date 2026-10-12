"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"

import EntriesGrid from "@/components/entries-grid"
import ExpensesGrid from "@/components/expenses-grid"

/** The full entries / expenses grid, collapsed at the bottom of the
 * independent home page. The breakdowns above edit with the same pop-ups
 * (entry-cell-editors.tsx, expense-cell-editors.tsx); this keeps the table
 * view around while that's new. Stays mounted while collapsed so opening it
 * is instant. */
export default function AllRecordsSection({ kind, count, defaultOpen = false, className = "order-5" }: {
    kind: "entries" | "expenses";
    count: number;
    /** W-2 home edits only through the grid, so it starts open there. */
    defaultOpen?: boolean;
    className?: string;
}) {
    const [open, setOpen] = useState(defaultOpen);
    const title = kind === "entries" ? "All entries" : "All expenses";
    return (<section className={`${className} space-y-3`}>
      <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 rounded-[22px] bg-card border border-card-border px-5 py-4 text-left">
        <span>
          <span className="block text-lg font-semibold text-foreground">{title}</span>
          <span className="block text-sm text-muted-foreground">
            {count} this period · tap a value to edit
          </span>
        </span>
        <ChevronDown className={`size-5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true"/>
      </button>
      <div hidden={!open}>
        {kind === "entries" ? <EntriesGrid /> : <ExpensesGrid />}
      </div>
    </section>);
}
