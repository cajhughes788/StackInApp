// /lib/stores/useExpenseMemoryStore.ts
"use client";
import { create } from "zustand";
type ExpenseMemoryPattern = {
    vendor: string;
    account: string;
};
type ExpenseMemory = {
    vendors: string[];
    descriptions: string[];
    accounts: string[];
    patterns: ExpenseMemoryPattern[];
};
type ExpenseLike = {
    vendor: string;
    description: string;
    account: string;
};
type ExpenseMemoryStore = {
    memory: ExpenseMemory;
    hydrated: boolean;
    hydrateFromStorageOnce: () => void;
    updateFromExpense: (expense: ExpenseLike) => void;
    clear: () => void;
    getVendorSuggestions: (query: string) => string[];
    getDescriptionSuggestions: (query: string) => string[];
    getAccountSuggestions: (query: string) => string[];
    getAccountForVendor: (vendor: string) => string | undefined;
};
const STORAGE_KEY = "stackin.expenseMemory";
const emptyMemory: ExpenseMemory = {
    vendors: [],
    descriptions: [],
    accounts: [],
    patterns: [],
};
function loadFromStorage(): ExpenseMemory {
    if (typeof window === "undefined")
        return emptyMemory;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw)
            return emptyMemory;
        const parsed = JSON.parse(raw) as Partial<ExpenseMemory> | null;
        if (!parsed)
            return emptyMemory;
        return {
            vendors: Array.isArray(parsed.vendors) ? parsed.vendors : [],
            descriptions: Array.isArray(parsed.descriptions) ? parsed.descriptions : [],
            accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
            patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
        };
    }
    catch (err) {
        return emptyMemory;
    }
}
function saveToStorage(memory: ExpenseMemory) {
    if (typeof window === "undefined")
        return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
    }
    catch (err) {
    }
}
function clearStorage() {
    if (typeof window === "undefined")
        return;
    try {
        window.localStorage.removeItem(STORAGE_KEY);
    }
    catch (err) {
    }
}
export const useExpenseMemoryStore = create<ExpenseMemoryStore>((set, get) => ({
    memory: emptyMemory,
    hydrated: false,
    hydrateFromStorageOnce() {
        if (get().hydrated)
            return;
        const loaded = loadFromStorage();
        set({ memory: loaded, hydrated: true });
    },
    updateFromExpense(expense) {
        const current = get().memory;
        const vendors = new Set(current.vendors);
        const descriptions = new Set(current.descriptions);
        const accounts = new Set(current.accounts);
        const patterns = [...current.patterns];
        if (expense.vendor.trim())
            vendors.add(expense.vendor.trim());
        if (expense.description.trim())
            descriptions.add(expense.description.trim());
        if (expense.account.trim())
            accounts.add(expense.account.trim());
        if (expense.vendor.trim() && expense.account.trim()) {
            const vendor = expense.vendor.trim();
            const account = expense.account.trim();
            const existingIndex = patterns.findIndex((p) => p.vendor.toLowerCase() === vendor.toLowerCase());
            if (existingIndex >= 0) {
                patterns[existingIndex] = { vendor, account };
            }
            else {
                patterns.push({ vendor, account });
            }
        }
        const updated: ExpenseMemory = {
            vendors: Array.from(vendors),
            descriptions: Array.from(descriptions),
            accounts: Array.from(accounts),
            patterns,
        };
        saveToStorage(updated);
        set({ memory: updated });
    },
    clear() {
        clearStorage();
        set({ memory: emptyMemory, hydrated: false });
    },
    getVendorSuggestions(query) {
        const q = query.trim().toLowerCase();
        if (!q)
            return [];
        const { vendors } = get().memory;
        return vendors
            .filter((v) => v.toLowerCase().startsWith(q))
            .slice(0, 5);
    },
    getDescriptionSuggestions(query) {
        const q = query.trim().toLowerCase();
        if (!q)
            return [];
        const { descriptions } = get().memory;
        return descriptions
            .filter((d) => d.toLowerCase().startsWith(q))
            .slice(0, 5);
    },
    getAccountSuggestions(query) {
        const q = query.trim().toLowerCase();
        if (!q)
            return [];
        const { accounts } = get().memory;
        return accounts
            .filter((a) => a.toLowerCase().startsWith(q))
            .slice(0, 5);
    },
    getAccountForVendor(vendor) {
        const v = vendor.trim().toLowerCase();
        if (!v)
            return undefined;
        const { patterns } = get().memory;
        const match = patterns.find((p) => p.vendor.toLowerCase() === v);
        return match?.account;
    },
}));
