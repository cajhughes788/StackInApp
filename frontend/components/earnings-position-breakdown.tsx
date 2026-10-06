"use client";
// /components/earnings-position-breakdown.tsx
// Per-position hours and hourly pay for one pay period (no tips/cash —
// those stay in the period totals). Rendered only when the period mixes
// more than one position or rate.
import { formatCurrency } from "@/lib/helpers";
import { getEntryPositionTitle } from "@shared/hourlyRates";

type Row = Record<string, any>;
type Settings = Parameters<typeof getEntryPositionTitle>[1];

export type PositionBreakdownLine = {
    title: string;
    rate: number;
    hours: number;
    pay: number;
};

/** Groups W-2 rows by (position title, rate). Hours and pay come from the
 * earnings page's own row helpers (paid hours, hourly gross) so every line
 * uses exactly the same math as the rest of earnings and the totals agree. */
export function buildPositionBreakdown(rows: Row[], settings: Settings, calc: {
    paidHours: (row: Row) => number;
    hourlyPay: (row: Row) => number;
}): PositionBreakdownLine[] {
    const lines = new Map<string, PositionBreakdownLine>();
    for (const row of rows) {
        const rate = Number(row.w2?.rate ?? NaN);
        const hours = calc.paidHours(row);
        if (!Number.isFinite(rate) || !(hours > 0))
            continue;
        const title = getEntryPositionTitle(row.w2, settings);
        const key = `${title.toLowerCase()}|${rate.toFixed(2)}`;
        const line = lines.get(key) ?? { title, rate, hours: 0, pay: 0 };
        line.hours += hours;
        line.pay += calc.hourlyPay(row);
        lines.set(key, line);
    }
    return [...lines.values()].sort((a, b) => b.pay - a.pay);
}

export default function EarningsPositionBreakdown({ lines }: { lines: PositionBreakdownLine[] }) {
    if (lines.length < 2)
        return null;
    const totalHours = lines.reduce((sum, l) => sum + l.hours, 0);
    const totalPay = lines.reduce((sum, l) => sum + l.pay, 0);
    return (<section className="rounded-[1.75rem] border border-slate-200 bg-slate-50/70 p-4 md:p-5">
      <h2 className="text-lg font-semibold text-slate-900">Hours by Position</h2>
      <div className="mt-3 overflow-hidden rounded-[1.1rem] border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Position</th>
              <th className="px-3 py-2 text-right font-medium">Rate</th>
              <th className="px-3 py-2 text-right font-medium">Hours</th>
              <th className="px-3 py-2 text-right font-medium">Hourly Pay</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (<tr key={`${l.title}|${l.rate}`} className="border-t border-slate-100">
                <td className="max-w-[9rem] truncate px-3 py-2 text-slate-900">{l.title}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(l.rate)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.hours.toFixed(2)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(l.pay)}</td>
              </tr>))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 font-semibold text-slate-900">
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2"/>
              <td className="px-3 py-2 text-right tabular-nums">{totalHours.toFixed(2)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totalPay)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>);
}
