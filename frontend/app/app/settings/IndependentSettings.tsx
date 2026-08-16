"use client"

import { useState, useEffect } from "react"
import { Info } from "lucide-react"
import { useRouter } from "next/navigation"
import { IndependentSettingsType } from "@shared/schemas/settings"
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
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Gauge Targets</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="incomeTargetPerMonth">Target Income Per Month ($)</Label>
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
            <Label htmlFor="expenseTargetPerMonth">Expense Budget Per Month ($)</Label>
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

          <p className="text-sm text-muted-foreground">
            When targets are set, your monthly income and expense gauges will scale based on progress toward those amounts.
          </p>
        </CardContent>
      </Card>

      {/* HOURS TRACKING */}
      <Card>
        <CardHeader>
          <CardTitle>Hours Tracking</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Track Hours</Label>
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
          <CardTitle>Tip Settings</CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Main toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Receives Tips</Label>
              <p className="text-sm text-muted-foreground">
                Allows you to track all forms of tips.
              </p>
            </div>

            <Switch
              checked={local.isTippedIndependent ?? false} // FIX: optional boolean fallback
              onCheckedChange={(v) =>
                update("isTippedIndependent", v, "immediate")
              }
            />
          </div>

          {local.isTippedIndependent && (
            <div className="space-y-5 pl-3 border-l">
              <div className="flex items-center justify-between">
                <Label>Credit Card Tips</Label>
                <Switch
                  checked={local.askCardTips ?? false}
                  onCheckedChange={(v) =>
                    update("askCardTips", v, "immediate")
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <Label>Reported Cash</Label>
                <Switch
                  checked={local.askReportedCash ?? false}
                  onCheckedChange={(v) =>
                    update("askReportedCash", v, "immediate")
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Unreported Cash</Label>
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

              {/* Include unreported cash in UI */}
              {local.askUnreportedCash && (
                <div className="flex items-center justify-between pl-2">
                  <div>
                    <Label>Include in income totals?</Label>
                    <p className="text-xs text-muted-foreground">
                      Adds unreported cash to gauge + averages.
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
            </div>
          )}
        </CardContent>
      </Card>

      {/* BUILT-IN INCOME SOURCES */}
      <Card>
        <CardHeader>
          <CardTitle>Built-In Income Sources</CardTitle>
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

          <div className="flex items-center justify-between">
            <Label>POS Sales</Label>
            <Switch
              checked={local.enablePosSales ?? false} // FIX: optional boolean fallback
              onCheckedChange={(v) =>
                update("enablePosSales", v, "immediate")
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <Label>Cash Sales</Label>
            <Switch
              checked={local.enableCashSales ?? false}
              onCheckedChange={(v) =>
                update("enableCashSales", v, "immediate")
              }
            />
          </div>
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
                <Label>Enable Vehicle Tracking</Label>
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
          <CardTitle>Custom Income Fields</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          {(local.customIncomeFields ?? []).map((field, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={field.label}
                onChange={(e) =>
                  updateCustomField(i, e.target.value)
                }
                placeholder="Custom income name"
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
            + Add Custom Field
          </Button>
        </CardContent>
      </Card>

      {/* RECURRING */}
      <Card>
        <CardHeader>
          <CardTitle>Recurring Expenses & Income</CardTitle>
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
