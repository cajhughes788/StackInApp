"use client"

import { useCallback, useId, useMemo, useState } from "react"
import { ChevronDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  getVisibleExpenseCategoryOptions,
  isExpenseCategoryNameTaken,
  normalizeExpenseCategory,
  sanitizeExpenseCategoryName,
} from "@/lib/expenseCategories"
import * as settingsService from "@/lib/domain/settingsService"
import { useSettingsStore } from "@/lib/stores/useSettingsStore"
import { cn } from "@/lib/utils"

type ExpenseCategoryPickerProps = {
  workspaceId: string | null
  value: string
  onSelect: (category: string) => void
  workspaceType?: "independent" | "w2"
  placeholder?: string
  dialogTitle?: string
  dialogDescription?: string
  customDialogTitle?: string
  customDialogDescription?: string
  triggerClassName?: string
  disabled?: boolean
}

export default function ExpenseCategoryPicker({
  workspaceId,
  value,
  onSelect,
  workspaceType = "independent",
  placeholder = "Choose expense category",
  dialogTitle = "Choose Expense Category",
  dialogDescription,
  customDialogTitle = "New Custom Category",
  customDialogDescription = "Save a category name once and it will stay available for this workspace.",
  triggerClassName,
  disabled = false,
}: ExpenseCategoryPickerProps) {
  const customCategoryInputId = useId()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [categoryQuery, setCategoryQuery] = useState("")
  const [customDialogOpen, setCustomDialogOpen] = useState(false)
  const [customCategoryDraft, setCustomCategoryDraft] = useState("")
  const [customCategoryError, setCustomCategoryError] = useState<string | null>(null)
  const [savingCustomCategory, setSavingCustomCategory] = useState(false)
  const [localCustomCategories, setLocalCustomCategories] = useState<string[]>([])

  const setSettings = useSettingsStore((state) => state.setSettings)
  const settingsEntry = useSettingsStore((state) =>
    workspaceId ? state.byWorkspaceId[workspaceId] : undefined
  )
  const settings = settingsEntry?.data ?? null
  const customExpenseCategories = settings?.independent?.customExpenseCategories ?? []
  const categoryOptions = useMemo(
    () =>
      getVisibleExpenseCategoryOptions(
        [...localCustomCategories, ...customExpenseCategories],
        {
          workspaceType,
          independentSettings: settings?.independent ?? null,
        },
        {
          includeCategories: value ? [value] : [],
        }
      ),
    [customExpenseCategories, localCustomCategories, settings?.independent, value, workspaceType]
  )
  const filteredCategoryOptions = useMemo(() => {
    const query = normalizeExpenseCategory(categoryQuery)
    if (!query) return categoryOptions

    return categoryOptions.filter((option) =>
      normalizeExpenseCategory(option).includes(query)
    )
  }, [categoryOptions, categoryQuery])

  const dismissKeyboard = useCallback(() => {
    if (typeof document === "undefined") return

    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement) {
      activeElement.blur()
    }
  }, [])

  const selectCategory = useCallback(
    (category: string) => {
      onSelect(category)
      setDialogOpen(false)
      setCategoryQuery("")
      dismissKeyboard()
    },
    [dismissKeyboard, onSelect]
  )

  const openCustomCategoryDialog = useCallback(() => {
    setDialogOpen(false)
    setCustomCategoryError(null)
    setCustomCategoryDraft(sanitizeExpenseCategoryName(categoryQuery))
    setCustomDialogOpen(true)
  }, [categoryQuery])

  const saveCustomCategory = useCallback(async () => {
    if (!workspaceId || savingCustomCategory) return

    const label = sanitizeExpenseCategoryName(customCategoryDraft)
    if (!label) {
      setCustomCategoryError("Enter a category name.")
      return
    }

    if (isExpenseCategoryNameTaken(label, customExpenseCategories)) {
      setCustomCategoryError("That category already exists.")
      return
    }

    const nextCustomCategories = [label, ...customExpenseCategories]
    const optimisticSettings = {
      ...(settings ?? {}),
      independent: {
        ...(settings?.independent ?? {}),
        customExpenseCategories: nextCustomCategories,
      },
    }

    setSavingCustomCategory(true)
    setCustomCategoryError(null)
    setLocalCustomCategories((current) => [label, ...current.filter((item) => item !== label)])
    setSettings(workspaceId, optimisticSettings, {
      source: "optimistic",
      localUpdatedAt: Date.now(),
    })

    try {
      const savedSettings = await settingsService.save(workspaceId, {
        independent: {
          customExpenseCategories: nextCustomCategories,
        },
      })

      if (savedSettings.source === "backend" && savedSettings.data) {
        setSettings(workspaceId, savedSettings.data, {
          source: "backend",
          remoteMeta: savedSettings.remoteMeta,
          lastSuccessfulSyncAt: savedSettings.lastSuccessfulSyncAt,
          localUpdatedAt: savedSettings.localUpdatedAt,
        })
      }

      onSelect(label)
      setCustomCategoryDraft("")
      setCategoryQuery("")
      setCustomDialogOpen(false)
      if (typeof window !== "undefined") {
        window.requestAnimationFrame(() => {
          setDialogOpen(true)
        })
      } else {
        setDialogOpen(true)
      }
      dismissKeyboard()
    } catch (error) {
      setCustomCategoryError(
        "We kept that category locally, but the sync needs attention before it is fully saved everywhere."
      )
    } finally {
      setSavingCustomCategory(false)
    }
  }, [
    customCategoryDraft,
    customExpenseCategories,
    dismissKeyboard,
    onSelect,
    savingCustomCategory,
    setSettings,
    settings,
    workspaceId,
  ])

  const triggerDisabled = disabled || !workspaceId

  return (
    <>
      <button
        type="button"
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
          triggerClassName
        )}
        onClick={() => {
          setCategoryQuery("")
          setDialogOpen(true)
        }}
        disabled={triggerDisabled}
      >
        <span
          className={cn(
            "truncate",
            value ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {value || placeholder}
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) {
            setCategoryQuery("")
          }
        }}
      >
        <DialogContent
          className="max-h-[85vh] overflow-hidden p-0 sm:max-w-md"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <DialogHeader className="border-b px-6 pt-6 pb-4">
            <DialogTitle>{dialogTitle}</DialogTitle>
            {dialogDescription ? (
              <DialogDescription>{dialogDescription}</DialogDescription>
            ) : null}
          </DialogHeader>

          <div className="space-y-4 px-6 py-4">
            <Input
              value={categoryQuery}
              onChange={(event) => setCategoryQuery(event.target.value)}
              placeholder="Search categories"
              autoComplete="off"
            />

            <div
              className="max-h-[min(52vh,22rem)] overflow-y-auto overscroll-contain rounded-md border border-border bg-card"
              style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
            >
              <button
                type="button"
                className="sticky top-0 z-10 block w-full border-b border-border bg-card px-3 py-3 text-left text-sm font-medium hover:bg-accent"
                onClick={openCustomCategoryDialog}
              >
                + Custom Category
              </button>

              {filteredCategoryOptions.length === 0 ? (
                <div className="px-3 py-6 text-sm text-muted-foreground">
                  No categories matched that search.
                </div>
              ) : (
                filteredCategoryOptions.map((category) => (
                  <button
                    key={category}
                    type="button"
                    className={cn(
                      "block w-full border-b border-border px-3 py-3 text-left text-sm last:border-b-0 hover:bg-accent",
                      value === category ? "bg-accent/60 font-medium" : ""
                    )}
                    onClick={() => selectCategory(category)}
                  >
                    {category}
                  </button>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={customDialogOpen}
        onOpenChange={(open) => {
          setCustomDialogOpen(open)
          if (!open) {
            setCustomCategoryError(null)
            setSavingCustomCategory(false)
          }
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{customDialogTitle}</DialogTitle>
            <DialogDescription>{customDialogDescription}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label htmlFor={customCategoryInputId} className="text-sm font-medium">
              Category Name
            </label>
            <Input
              id={customCategoryInputId}
              value={customCategoryDraft}
              onChange={(event) => {
                setCustomCategoryDraft(event.target.value)
                if (customCategoryError) {
                  setCustomCategoryError(null)
                }
              }}
              placeholder="Example: Studio Decor"
              autoComplete="off"
            />
            {customCategoryError ? (
              <p className="text-sm text-destructive">{customCategoryError}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCustomDialogOpen(false)}
              disabled={savingCustomCategory}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={saveCustomCategory}
              disabled={savingCustomCategory}
            >
              {savingCustomCategory ? "Saving..." : "Save Category"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
