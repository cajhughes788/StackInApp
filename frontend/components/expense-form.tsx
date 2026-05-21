// /components/expense-form.tsx
"use client";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Plus, Minus, Info } from "lucide-react";
import { calculateStandardMileageAmount, getBusinessMileageRate } from "@shared/businessMileage";
import { ExpenseInput } from "@shared/schemas/expense";
import * as expensesService from "@/lib/domain/expenseService";
import { EXPENSE_CATEGORY_OPTIONS, findExpenseCategoryGuideEntry, normalizeExpenseCategoryLabel, } from "@/lib/expenseCategories";
import { useExpenseMemoryStore } from "@/lib/stores/useExpenseMemoryStore";
import { useSettingsStore } from "@/lib/stores/useSettingsStore";
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getLocalDateInputValue } from "@/lib/helpers";
const ExpenseInputSchema = ExpenseInput;
type FormState = {
    date: string;
    amount: string;
    vendor: string;
    description: string;
    account: string;
    milesDriven: string;
    parkingAndTolls: string;
};

function createEmptyFormState(): FormState {
    const today = getLocalDateInputValue();
    return {
        date: today,
        amount: "",
        vendor: "",
        description: "",
        account: "",
        milesDriven: "",
        parkingAndTolls: "",
    };
}

function isFreshFormState(form: FormState): boolean {
    return (form.amount === "" &&
        form.vendor === "" &&
        form.description === "" &&
        form.account === "" &&
        form.milesDriven === "" &&
        form.parkingAndTolls === "");
}

export default function ExpenseForm() {
    const workspaceState = useWorkspaceStore((s) => s.state);
    const activeWorkspaceId = workspaceState.status === "ready"
        ? workspaceState.activeWorkspaceId
        : null;
    const [form, setForm] = useState<FormState>(() => createEmptyFormState());
    const [submitting, setSubmitting] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const { hydrateFromStorageOnce, getVendorSuggestions, getDescriptionSuggestions, getAccountForVendor, updateFromExpense, } = useExpenseMemoryStore();
    const settingsEntry = useSettingsStore((s) => activeWorkspaceId ? s.byWorkspaceId[activeWorkspaceId] : undefined);
    const settings = settingsEntry?.data ?? null;
    useEffect(() => {
        hydrateFromStorageOnce();
    }, [hydrateFromStorageOnce]);
    const [vendorFocused, setVendorFocused] = useState(false);
    const [descriptionFocused, setDescriptionFocused] = useState(false);
    const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);
    const accountFieldRef = useRef<HTMLDivElement | null>(null);
    const accountInputRef = useRef<HTMLInputElement | null>(null);
    const vendorSuggestions = vendorFocused
        ? getVendorSuggestions(form.vendor)
        : [];
    const descriptionSuggestions = descriptionFocused
        ? getDescriptionSuggestions(form.description)
        : [];
    const accountSuggestions = accountDropdownOpen
        ? EXPENSE_CATEGORY_OPTIONS.filter((option) => option.toLowerCase().includes(form.account.trim().toLowerCase()))
        : [];
    const selectedCategoryGuide = useMemo(() => findExpenseCategoryGuideEntry(form.account), [form.account]);
    const normalizedAccountLabel = useMemo(() => normalizeExpenseCategoryLabel(form.account), [form.account]);
    const shouldShowMileageHelper = settings?.independent?.trackBusinessMileage === true &&
        normalizedAccountLabel === "Vehicle & Transportation";
    const mileageRate = useMemo(() => getBusinessMileageRate(form.date || new Date()), [form.date]);
    const milesDrivenNumber = form.milesDriven.trim() === "" ? 0 : Number(form.milesDriven);
    const parkingAndTollsNumber = form.parkingAndTolls.trim() === "" ? 0 : Number(form.parkingAndTolls);
    const calculatedMileageAmount = calculateStandardMileageAmount(Number.isNaN(milesDrivenNumber) ? 0 : milesDrivenNumber, mileageRate, Number.isNaN(parkingAndTollsNumber) ? 0 : parkingAndTollsNumber);
    useEffect(() => {
        function handlePointerDown(event: MouseEvent) {
            if (!accountFieldRef.current)
                return;
            if (accountFieldRef.current.contains(event.target as Node))
                return;
            setAccountDropdownOpen(false);
        }
        document.addEventListener("mousedown", handlePointerDown);
        return () => document.removeEventListener("mousedown", handlePointerDown);
    }, []);
    const updateField = useCallback((field: keyof FormState, value: string) => {
        setForm((prev) => {
            const next = { ...prev, [field]: value };
            if (field === "vendor") {
                const autoAccount = getAccountForVendor(value);
                if (autoAccount && !prev.account) {
                    next.account = autoAccount;
                }
            }
            return next;
        });
    }, [getAccountForVendor]);
    const dismissKeyboard = useCallback(() => {
        if (typeof document === "undefined")
            return;
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement) {
            activeElement.blur();
        }
    }, []);
    const selectAccountSuggestion = useCallback((account: string) => {
        updateField("account", account);
        setAccountDropdownOpen(false);
        requestAnimationFrame(() => {
            accountInputRef.current?.blur();
            dismissKeyboard();
        });
    }, [dismissKeyboard, updateField]);
    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitting)
            return;
        if (!activeWorkspaceId) {
            alert("No active workspace selected.");
            return;
        }
        setSubmitting(true);
        try {
            const periodId = form.date ? form.date.slice(0, 7) : "";
            const normalizedAccountEntry = findExpenseCategoryGuideEntry(form.account);
            const normalizedAccount = normalizedAccountEntry?.category ?? null;
            if (!normalizedAccount) {
                alert("Please choose an expense category from the built-in list.");
                setSubmitting(false);
                return;
            }
            const resolvedAmount = shouldShowMileageHelper &&
                form.amount.trim() === "" &&
                (milesDrivenNumber > 0 || parkingAndTollsNumber > 0)
                ? String(calculatedMileageAmount)
                : form.amount;
            const amountNumber = resolvedAmount === "" ? NaN : Number(resolvedAmount);
            const payload = {
                date: form.date,
                amount: amountNumber,
                vendor: form.vendor.trim(),
                description: form.description.trim(),
                account: normalizedAccount,
                periodId,
                calculationMethod: shouldShowMileageHelper && (milesDrivenNumber > 0 || parkingAndTollsNumber > 0)
                    ? "standard_mileage"
                    : "manual",
                milesDriven: shouldShowMileageHelper && milesDrivenNumber > 0 ? milesDrivenNumber : undefined,
                mileageRate: shouldShowMileageHelper && (milesDrivenNumber > 0 || parkingAndTollsNumber > 0)
                    ? mileageRate
                    : undefined,
                parkingAndTolls: shouldShowMileageHelper && parkingAndTollsNumber > 0
                    ? parkingAndTollsNumber
                    : undefined,
            };
            const parsed = ExpenseInputSchema.safeParse(payload);
            if (!parsed.success) {
                const firstIssue = parsed.error.issues[0];
                const message = firstIssue?.message ||
                    "Some required fields are missing or invalid.";
                alert(message);
                setSubmitting(false);
                return;
            }
            const validated = parsed.data;
            const submittedForm = form;
            const createExpensePromise = expensesService.createExpense(activeWorkspaceId, validated);
            setForm(createEmptyFormState());
            setVendorFocused(false);
            setDescriptionFocused(false);
            setAccountDropdownOpen(false);
            setExpanded(false);
            dismissKeyboard();
            setSubmitting(false);
            void createExpensePromise
                .then(() => {
                updateFromExpense({
                    vendor: validated.vendor,
                    description: validated.description,
                    account: validated.account,
                });
            })
                .catch(() => {
                setExpanded(true);
                setForm((current) => isFreshFormState(current) ? submittedForm : current);
                alert("Failed to save expense. Please try again.");
            });
            return;
        }
        catch (err) {
            alert("Failed to save expense. Please try again.");
        }
        finally {
            setSubmitting(false);
        }
    }, [
        activeWorkspaceId,
        calculatedMileageAmount,
        form,
        mileageRate,
        milesDrivenNumber,
        parkingAndTollsNumber,
        shouldShowMileageHelper,
        submitting,
        dismissKeyboard,
        updateFromExpense,
    ]);
    if (workspaceState.status !== "ready") {
        return (<Card className={`gap-0 py-4`}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 px-5">
          <div className="flex items-center gap-2">
            <CardTitle>Add Expense</CardTitle>
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="Expense form help">
                  <Info className="h-4 w-4"/>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 text-sm">
                Tap the plus button to expand and add a new expense.
              </PopoverContent>
            </Popover>
          </div>
          <Button type="button" variant="outline" size="icon" onClick={() => setExpanded((current) => !current)} aria-label={expanded ? "Collapse expense form" : "Expand expense form"}>
            {expanded ? <Minus /> : <Plus />}
          </Button>
        </CardHeader>
        <CardContent className="px-5 pt-0">
          <p className="text-sm text-muted-foreground">Loading workspace...</p>
        </CardContent>
      </Card>);
    }
    return (<Card className={expanded ? "gap-6 py-6" : "gap-0 py-4"}>
      <CardHeader className={`flex flex-row items-center justify-between space-y-0 ${expanded ? "" : "px-5"}`}>
        <div className="flex items-center gap-2">
          <CardTitle>Add Expense</CardTitle>
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="Expense form help">
                <Info className="h-4 w-4"/>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 text-sm">
              Tap the plus button to expand and add a new expense.
            </PopoverContent>
          </Popover>
        </div>
        <Button type="button" variant="outline" size="icon" onClick={() => setExpanded((current) => !current)} aria-label={expanded ? "Collapse expense form" : "Expand expense form"}>
          {expanded ? <Minus /> : <Plus />}
        </Button>
      </CardHeader>

      {!expanded ? (<CardContent className="px-5 pt-0 pb-0"/>) : (<CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Date */}
          <div>
            <Label htmlFor="date">Date</Label>
            <Input id="date" type="date" value={form.date} onChange={(e) => updateField("date", e.target.value)} required/>
          </div>

          {/* Amount */}
          <div>
            <Label htmlFor="amount">Amount</Label>
            <Input id="amount" type="number" step="0.01" value={form.amount} onChange={(e) => updateField("amount", e.target.value)} required/>
          </div>

          {/* Vendor with suggestions */}
          <div className="relative">
            <Label htmlFor="vendor">Vendor</Label>
            <Input id="vendor" type="text" value={form.vendor} onChange={(e) => updateField("vendor", e.target.value)} onFocus={() => setVendorFocused(true)} onBlur={() => {
                setTimeout(() => setVendorFocused(false), 100);
            }} autoComplete="off" required/>
            {vendorSuggestions.length > 0 && (<div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-card shadow">
                {vendorSuggestions.map((v) => (<button key={v} type="button" className="block w-full px-3 py-1 text-left text-sm hover:bg-muted" onMouseDown={(e) => {
                        e.preventDefault();
                        updateField("vendor", v);
                    }}>
                    {v}
                  </button>))}
              </div>)}
          </div>

          {/* Description with suggestions */}
          <div className="relative">
            <Label htmlFor="description">Description</Label>
            <Input id="description" type="text" value={form.description} onChange={(e) => updateField("description", e.target.value)} onFocus={() => setDescriptionFocused(true)} onBlur={() => {
                setTimeout(() => setDescriptionFocused(false), 100);
            }} autoComplete="off" required/>
            {descriptionSuggestions.length > 0 && (<div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-card shadow">
                {descriptionSuggestions.map((d) => (<button key={d} type="button" className="block w-full px-3 py-1 text-left text-sm hover:bg-muted" onMouseDown={(e) => {
                        e.preventDefault();
                        updateField("description", d);
                    }}>
                    {d}
                  </button>))}
              </div>)}
          </div>

          {/* Account with suggestions */}
          <div ref={accountFieldRef} className="relative">
            <div className="flex items-center gap-2">
              <Label htmlFor="account">Category</Label>
              {selectedCategoryGuide ? (<Popover>
                  <PopoverTrigger asChild>
                    <button type="button" className="rounded-full p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label={`About ${selectedCategoryGuide.category}`}>
                      <Info className="h-4 w-4"/>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80 space-y-2 text-sm">
                    <div className="font-medium">{selectedCategoryGuide.category}</div>
                    <p className="text-muted-foreground">
                      {selectedCategoryGuide.shortSummary}
                    </p>
                    <p>
                      <span className="font-medium">Includes:</span>{" "}
                      {selectedCategoryGuide.includes}
                    </p>
                    <p>
                      <span className="font-medium">Rule of thumb:</span>{" "}
                      {selectedCategoryGuide.ruleOfThumb}
                    </p>
                  </PopoverContent>
                </Popover>) : null}
            </div>
            <Input ref={accountInputRef} id="account" type="text" value={form.account} onChange={(e) => updateField("account", e.target.value)} onFocus={() => setAccountDropdownOpen(true)} placeholder="Start typing to choose a category" autoComplete="off" required/>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose from the built-in expense category list.
            </p>
            {accountSuggestions.length > 0 && (<div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-card shadow">
                {accountSuggestions.map((a) => (<button key={a} type="button" className="block w-full px-3 py-1 text-left text-sm hover:bg-muted" onPointerDown={(e) => {
                        e.preventDefault();
                        selectAccountSuggestion(a);
                    }} onClick={() => selectAccountSuggestion(a)}>
                    {a}
                  </button>))}
              </div>)}
          </div>

          {shouldShowMileageHelper ? (<div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">Mileage Helper</div>
                <p className="text-xs text-muted-foreground">
                  Easiest option for most solo businesses: track deductible business miles,
                  then apply the IRS standard mileage rate for the expense date. Do not include
                  your regular commute from home to your main workplace.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label htmlFor="milesDriven">Business Miles</Label>
                  <Input id="milesDriven" type="number" step="0.1" min="0" placeholder="0" value={form.milesDriven} onChange={(e) => updateField("milesDriven", e.target.value)}/>
                </div>

                <div>
                  <Label htmlFor="parkingAndTolls">Parking & Tolls</Label>
                  <Input id="parkingAndTolls" type="number" step="0.01" min="0" placeholder="Optional" value={form.parkingAndTolls} onChange={(e) => updateField("parkingAndTolls", e.target.value)}/>
                </div>
              </div>

              <div className="flex flex-col gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">
                    IRS standard mileage rate
                  </span>
                  <span className="font-medium">
                    {(mileageRate * 100).toFixed(1)} cents/mile
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Calculated total</span>
                  <span className="font-semibold">
                    ${calculatedMileageAmount.toFixed(2)}
                  </span>
                </div>
              </div>

              <Button type="button" variant="outline" className="w-full" onClick={() => updateField("amount", calculatedMileageAmount.toFixed(2))}>
                Use Calculated Amount
              </Button>
            </div>) : null}

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Saving..." : "Add Expense"}
          </Button>
        </form>
      </CardContent>)}
    </Card>);
}
