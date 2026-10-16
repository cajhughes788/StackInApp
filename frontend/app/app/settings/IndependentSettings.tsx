"use client"

import { useState, useEffect } from "react"
import { Info } from "lucide-react"
import { useRouter } from "next/navigation"
import { IndependentSettingsType } from "@shared/schemas/settings"
import { isCashSourceEnabled, isPosSalesSourceEnabled } from "@shared/entryVisibility"
import { SHOW_TAX_SET_ASIDE, TAX_SET_ASIDE_DEFAULT_PERCENT } from "@shared/taxSetAside"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

export default function IndependentSettingsSection({
  data,
  onChange,
}: {
  data?: Partial<IndependentSettingsType>
  onChange: (
    patch: Partial<IndependentSettingsType>,
    behavior?: "immediate" | "deferred"
  ) => void
}) {
  const router = useRouter()
  const [local, setLocal] = useState<Partial<IndependentSettingsType>>(
    data ?? {}
  )

  useEffect(() => {
    setLocal(data ?? {})
  }, [data])

  function update<K extends keyof IndependentSettingsType>(
    field: K,
    value: IndependentSettingsType[K],
    behavior: "immediate" | "deferred" = "deferred"
  ) {
    setLocal((prev) => ({ ...prev, [field]: value }))
    onChange({ [field]: value }, behavior)
  }

  function updateMany(patch: Partial<IndependentSettingsType>, behavior: "immediate" | "deferred" = "deferred") {
    setLocal((prev) => ({ ...prev, ...patch }))
    onChange(patch, behavior)
  }

  // --- Custom income fields ---
  function updateCustomField(index: number, label: string) {
    // FIX: customIncomeFields may be undefined in sparse-doc mode
    const updated = [...(local.customIncomeFields ?? [])]
    updated[index] = { ...updated[index], label }
    update("customIncomeFields", updated, "deferred")
  }

  function addCustomField() {
    // FIX: spread with fallback for undefined
    update("customIncomeFields", [
      ...(local.customIncomeFields ?? []),
      { label: "" },
    ], "immediate")
  }

  function removeCustomField(index: number) {
    // FIX: customIncomeFields may be undefined
    const updated = [...(local.customIncomeFields ?? [])]
    updated.splice(index, 1)
    update("customIncomeFields", updated, "immediate")
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Monthly targets</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="incomeTargetPerMonth">Income goal per month ($)</Label>
            <Input
              id="incomeTargetPerMonth"
              type="number"
              step="0.01"
              min="0"
              placeholder="Optional"
              value={local.incomeTargetPerMonth ?? ""}
              onChange={(e) => {
                const raw = e.target.value
                if (raw === "") return update("incomeTargetPerMonth", undefined, "deferred")
                update("incomeTargetPerMonth", Number(raw), "deferred")
              }}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="expenseTargetPerMonth">Expense budget per month ($)</Label>
            <Input
              id="expenseTargetPerMonth"
              type="number"
              step="0.01"
              min="0"
              placeholder="Optional"
              value={local.expenseTargetPerMonth ?? ""}
              onChange={(e) => {
                const raw = e.target.value
                if (raw === "") return update("expenseTargetPerMonth", undefined, "deferred")
                update("expenseTargetPerMonth", Number(raw), "deferred")
              }}
            />
          </div>

          {SHOW_TAX_SET_ASIDE ? (
          <div className="space-y-2">
            <Label htmlFor="taxSetAsidePercent">Set aside for taxes (% of profit)</Label>
            <Input
              id="taxSetAsidePercent"
              type="number"
              step="1"
              min="0"
              max="100"
              placeholder={`${TAX_SET_ASIDE_DEFAULT_PERCENT} (default)`}
              value={local.taxSetAsidePercent ?? ""}
              onChange={(e) => {
                const raw = e.target.value
                if (raw === "") return update("taxSetAsidePercent", undefined, "deferred")
                update("taxSetAsidePercent", Math.min(100, Math.max(0, Number(raw))), "deferred")
              }}
            />
          </div>
          ) : null}

          <p className="text-sm text-muted-foreground">
            Your home screen shows each month’s income as a % of the goal and expenses as a % of the budget.
            {SHOW_TAX_SET_ASIDE
              ? " “Safe to spend” is your profit minus the share you set aside for taxes — a rough estimate, not tax advice."
              : null}
          </p>
        </CardContent>
      </Card>

      {/* WEEKLY SUMMARY */}
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label>Weekly summary</Label>
              <p className="text-sm text-muted-foreground">
                Monday morning: what you earned and kept last week, and anything that needs you.
              </p>
            </div>

            <Switch
              aria-label="Weekly summary"
              checked={local.weeklyDigest ?? true} // unset = on
              onCheckedChange={(v) => update("weeklyDigest", v, "immediate")}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label>Missing receipts in Needs you</Label>
              <p className="text-sm text-muted-foreground">
                Remind you about expenses over $75 that don&apos;t have a receipt yet.
              </p>
            </div>

            <Switch
              aria-label="Missing receipts in Needs you"
              checked={local.missingReceiptsInNeedsYou ?? true} // unset = on
              onCheckedChange={(v) => update("missingReceiptsInNeedsYou", v, "immediate")}
            />
          </div>
        </CardContent>
      </Card>

      {/* HOURS TRACKING */}
      <Card>
        <CardHeader>
          <CardTitle>Hours tracking</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Track hours</Label>
              <p className="text-sm text-muted-foreground">
                Enable manual hour tracking for daily entries.
              </p>
            </div>

            <Switch
              checked={local.trackHours ?? false} // FIX: optional boolean fallback
              onCheckedChange={(v) => update("trackHours", v, "immediate")}
            />
          </div>
        </CardContent>
      </Card>

      {/* TIPS */}
      <Card>
        <CardHeader>
          <CardTitle>Tips</CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* One switch for every source: a Tips line inside Venmo / Apple
              Pay / Zelle's split, and on top of sales for Card / POS and
              Cash (see paymentCategoryConfig in lib/incomeBreakdown.ts). It
              replaced the separate Credit Card Tips / Reported Cash toggles,
              which now just count as those sources being on. */}
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label>Receives tips</Label>
              <p className="text-sm text-muted-foreground">
                Adds a Tips line to each income source below. For Card / POS and Cash, tips are entered on top of
                sales.
              </p>
            </div>

            <Switch
              checked={local.isTippedIndependent ?? false} // FIX: optional boolean fallback
              onCheckedChange={(v) =>
                update("isTippedIndependent", v, "immediate")
              }
            />
          </div>

          {/* Tips live inside sources now — with none on, there'd be nowhere
              to enter them (the old standalone Credit Card Tips field is gone). */}
          {local.isTippedIndependent &&
          !local.enableVenmo &&
          !local.enableApplePay &&
          !local.enableZelle &&
          !isPosSalesSourceEnabled(local) &&
          !isCashSourceEnabled(local) ? (
            <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
              Turn on the income sources you&apos;re paid through below — that&apos;s where tips are entered.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* BUILT-IN INCOME SOURCES */}
      <Card>
        <CardHeader>
          <CardTitle>Income sources</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Venmo</Label>
            <Switch
              checked={local.enableVenmo ?? false} // FIX: optional boolean fallback
              onCheckedChange={(v) =>
                update("enableVenmo", v, "immediate")
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <Label>Apple Pay</Label>
            <Switch
              checked={local.enableApplePay ?? false} // FIX: optional boolean fallback
              onCheckedChange={(v) =>
                update("enableApplePay", v, "immediate")
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <Label>Zelle</Label>
            <Switch
              checked={local.enableZelle ?? false}
              onCheckedChange={(v) =>
                update("enableZelle", v, "immediate")
              }
            />
          </div>

          {/* Shown on for anyone who had Credit Card Tips on (card tips live
              here now); turning it off clears both. */}
          <div className="flex items-center justify-between">
            <Label>Card / POS Sales</Label>
            <Switch
              checked={isPosSalesSourceEnabled(local)}
              onCheckedChange={(v) =>
                updateMany(v ? { enablePosSales: true } : { enablePosSales: false, askCardTips: false }, "immediate")
              }
            />
          </div>

          {/* Same for Reported Cash (cash tips). */}
          <div className="flex items-center justify-between">
            <Label>Cash</Label>
            <Switch
              checked={isCashSourceEnabled(local)}
              onCheckedChange={(v) =>
                updateMany(v ? { enableCashSales: true } : { enableCashSales: false, askReportedCash: false }, "immediate")
              }
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label>Personal cash</Label>
              <p className="text-xs text-muted-foreground">
                For personal tracking only — not used in taxes.
              </p>
            </div>
            <Switch
              checked={local.askUnreportedCash ?? false}
              onCheckedChange={(v) =>
                update("askUnreportedCash", v, "immediate")
              }
            />
          </div>

          {local.askUnreportedCash && (
            <div className="flex items-center justify-between gap-4 border-l pl-3">
              <div>
                <Label>Include in income totals?</Label>
                <p className="text-xs text-muted-foreground">
                  Adds personal cash to your totals and averages.
                </p>
              </div>
              <Switch
                checked={local.includeUnreportedInUI ?? false}
                onCheckedChange={(v) =>
                  update("includeUnreportedInUI", v, "immediate")
                }
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vehicle & Transportation</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Label>Enable vehicle tracking</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="rounded-full p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      aria-label="Business mileage help"
                    >
                      <Info className="h-4 w-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-72 text-sm">
                    Turn on the Vehicle & Transportation category for this workspace.
                    You can log mileage-based trips or ordinary vehicle expenses like
                    gas, repairs, and parking. Regular commuting from home to your
                    main workplace does not count as business mileage.
                  </PopoverContent>
                </Popover>
              </div>
              <p className="text-sm text-muted-foreground">
                Enables both mileage tracking and direct vehicle expense tracking.
              </p>
            </div>

            <Switch
              checked={
                local.trackVehicleExpenses ??
                local.trackBusinessMileage ??
                false
              }
              onCheckedChange={(v) =>
                update("trackVehicleExpenses", v, "immediate")
              }
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Recommended for mobile appointments, supply runs, trips between work locations,
            and vehicle-related business purchases.
          </p>
        </CardContent>
      </Card>

      {/* CUSTOM INCOME FIELDS */}
      <Card>
        <CardHeader>
          <CardTitle>Other income names</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* The shared list behind "Who paid you?" in the entry form and the
              bank deposit review (lib/incomeNames.ts) — new names are added
              automatically as they're used. */}
          <p className="text-sm text-muted-foreground">
            Who pays you outside your built-in sources — clients and platforms like DoorDash. Keeping one name per
            payer makes your totals easy to check against the 1099s they send. Names you type when adding income are
            saved here automatically.
          </p>
          {(local.customIncomeFields ?? []).map((field, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={field.label}
                onChange={(e) =>
                  updateCustomField(i, e.target.value)
                }
                placeholder="e.g. DoorDash"
              />

              <Button
                variant="destructive"
                onClick={() => removeCustomField(i)}
              >
                Delete
              </Button>
            </div>
          ))}

          <Button variant="outline" onClick={addCustomField}>
            + Add name
          </Button>
        </CardContent>
      </Card>

      {/* INVOICES */}
      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Your business name, logo, color, payment terms and the &ldquo;How to pay&rdquo; note that appear on
            every invoice.
          </p>
          <Button variant="outline" onClick={() => router.push("/app/invoices/settings")}>
            Invoice settings
          </Button>
        </CardContent>
      </Card>

      {/* RECURRING */}
      <Card>
        <CardHeader>
          <CardTitle>Recurring expenses and income</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Manage rules that automatically create expenses or income on a schedule — set up from
            the expense form or a Custom Income entry with &ldquo;Repeats&rdquo; turned on.
          </p>
          <Button variant="outline" onClick={() => router.push("/app/recurring")}>
            Manage Recurring
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
