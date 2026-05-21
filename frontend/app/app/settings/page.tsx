// frontend/app/settings/page.ts
"use client";
import React, { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { SettingsDocSchema, SettingsPatch, SettingsPatchType, SettingsType, } from "@shared/schemas/settings";
import type { CommonSettingsType, W2SettingsType, IndependentSettingsType, } from "@shared/schemas/settings";
import * as settingsService from "@/lib/domain/settingsService";
import { createProfileTrace, withProfileStep } from "@/lib/observability/profileTrace";
import { syncWorkspaceGeofenceReminders } from "@/lib/mobile/geofenceReminderSync";
import { syncWorkspaceTimeEntryReminders } from "@/lib/mobile/timeEntryReminderSync";
import { useAuth } from "@/contexts/auth-context";
import { useSettingsStore } from "@/lib/stores/useSettingsStore";
import { useWorkspaceStore } from "@/lib/stores/useWorkspaceStore";
import { debugError, debugLog } from "@/lib/debugLoop";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { useNavigationGuardStore } from "@/lib/stores/useNavigationGuardStore";
import StackInHeader from "@/components/stackin-header";
import AppLoader from "@/components/app-loader";
import { cn } from "@/lib/utils";
import CommonSettingsSection from "./CommonSettings";
import W2SettingsSection from "./W2Settings";
import IndependentSettingsSection from "./IndependentSettings";
// ------------------------------------------------------------------------------------
// Types
// ------------------------------------------------------------------------------------
type SettingsFormData = {
    common?: Partial<CommonSettingsType>;
    w2?: Partial<W2SettingsType>;
    independent?: Partial<IndependentSettingsType>;
};
type SettingsChangeBehavior = "immediate" | "deferred";
const LOCATION_PLACEHOLDER_ADDRESS = "Pick a location";

function isAndroidPlatform(): boolean {
    return typeof window !== "undefined" &&
        Capacitor.isNativePlatform() &&
        Capacitor.getPlatform() === "android";
}

function hasChosenLocationReminderAddress(address?: string): boolean {
    const normalized = address?.trim();
    return !!normalized && normalized !== LOCATION_PLACEHOLDER_ADDRESS;
}

function sanitizeCommonSettingsForPersistence(common?: Partial<CommonSettingsType>): Partial<CommonSettingsType> | undefined {
    if (!common) {
        return common;
    }
    if (!("locationEntryReminders" in common)) {
        return common;
    }
    const locationEntryReminders = (common.locationEntryReminders ?? [])
        .filter((reminder) => hasChosenLocationReminderAddress(reminder.address))
        .slice(0, 1);
    return {
        ...common,
        locationEntryReminders,
    };
}

function sanitizeFormDataForPersistence(next: SettingsFormData): SettingsFormData {
    return {
        ...next,
        common: sanitizeCommonSettingsForPersistence(next.common),
    };
}

function withDetectedTimeZone(next: SettingsFormData): SettingsFormData {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (next.common?.timeZone) {
        return next;
    }
    return {
        ...next,
        common: {
            ...(next.common ?? {}),
            timeZone: detected,
        },
    };
}
function mergeSettings(base: SettingsType | null, patch: SettingsPatchType): SettingsType | null {
    if (!base) {
        return null;
    }
    return {
        common: {
            ...(base.common ?? {}),
            ...(patch.common ?? {}),
        },
        w2: {
            ...(base.w2 ?? {}),
            ...(patch.w2 ?? {}),
        },
        independent: {
            ...(base.independent ?? {}),
            ...(patch.independent ?? {}),
        },
    };
}
// ------------------------------------------------------------------------------------
// Settings Page
// ------------------------------------------------------------------------------------
export default function SettingsPage() {
    const router = useRouter();
    const { toast } = useToast();
    // New user welcome modal flag (same behavior as old file)
    let isNewUser = false;
    try {
        isNewUser = localStorage.getItem("new-user") === "true";
        if (isNewUser)
            localStorage.removeItem("new-user");
    }
    catch { }
    // ----------------------------------------------------------------------------------
    // Stores
    // ----------------------------------------------------------------------------------
    const { user, authLoading } = useAuth();
    const updateSettingsStore = useSettingsStore((s) => s.setSettings);
    const ensureSettingsLoaded = useSettingsStore((s) => s.ensureLoaded);
    const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
    const setNavigationGuard = useNavigationGuardStore((s) => s.setGuard);
    const clearNavigationGuard = useNavigationGuardStore((s) => s.clearGuard);
    const workspaceState = useWorkspaceStore((s) => s.state);
    const searchParams = useSearchParams();
    const setupWorkspaceId = searchParams.get("workspaceId");
    const isSetupMode = searchParams.get("setup") === "1" && !!setupWorkspaceId;
    const activeWorkspace = workspaceState.status === "ready"
        ? workspaceState.activeWorkspace
        : null;
    const activeWorkspaceId = workspaceState.status === "ready"
        ? workspaceState.activeWorkspaceId
        : null;
    const settingsEntry = useSettingsStore((s) => activeWorkspaceId ? s.byWorkspaceId[activeWorkspaceId] : undefined);
    const settings = settingsEntry?.data ?? null;
    const settingsLoading = activeWorkspaceId != null
        ? (settingsEntry?.status ?? "idle") === "loading"
        : true;
    const isInitialSettingsSetup = settings === null;
    // ----------------------------------------------------------------------------------
    // Local component state
    // ----------------------------------------------------------------------------------
    const [showWelcome, setShowWelcome] = useState(isNewUser);
    const [isSaving, setIsSaving] = useState(false);
    const [isTransitioningToHome, setIsTransitioningToHome] = useState(false);
    const [showInitialValidationFeedback, setShowInitialValidationFeedback] = useState(false);
    const [saveStatus, setSaveStatus] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
    const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
    const [hydratedWorkspaceId, setHydratedWorkspaceId] = useState<string | null>(null);
    const saveTraceRef = useRef<ReturnType<typeof createProfileTrace> | null>(null);
    const persistPromiseRef = useRef<Promise<boolean> | null>(null);
    const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const saveRequestIdRef = useRef(0);
    const activeSaveRequestRef = useRef(0);
    const latestPatchRef = useRef<SettingsPatchType | null>(null);
    const latestWorkspaceIdRef = useRef<string | null>(null);
    const latestSettingsRef = useRef<SettingsType | null>(null);
    const latestUserRef = useRef<typeof user | null>(null);
    const latestFormDataRef = useRef<SettingsFormData>({});
    const isInitialSettingsSetupRef = useRef(true);
    const saveStatusRef = useRef<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
    const hasHydratedWorkspaceRef = useRef(false);
    const lastChangeBehaviorRef = useRef<SettingsChangeBehavior>("deferred");
    const typedInputFocusedRef = useRef(false);
    // FIX #1:
    // Use sparse SettingsFormData instead of SettingsInputType
    const [formData, setFormData] = useState<SettingsFormData>(() => {
        if (settings)
            return settings as SettingsFormData;
        return {};
    });
    // ----------------------------------------------------------------------------------
    // Auto timezone (stored under common.timeZone)
    // ----------------------------------------------------------------------------------
    useEffect(() => {
        setFormData((prev) => {
            return withDetectedTimeZone(prev ?? {});
        });
    }, []);
    useEffect(() => {
        if (!activeWorkspaceId)
            return;
        ensureSettingsLoaded(activeWorkspaceId);
    }, [activeWorkspaceId, ensureSettingsLoaded]);
    useEffect(() => {
        if (!isSetupMode || !setupWorkspaceId || workspaceState.status !== "ready") {
            return;
        }
        const hasSetupWorkspace = workspaceState.workspaces.some((workspace) => workspace.id === setupWorkspaceId);
        if (!hasSetupWorkspace || workspaceState.activeWorkspaceId === setupWorkspaceId) {
            return;
        }
        setActiveWorkspace(setupWorkspaceId);
    }, [isSetupMode, setupWorkspaceId, workspaceState, setActiveWorkspace]);
    // ----------------------------------------------------------------------------------
    // Hydration — sparse-doc friendly (no SettingsInput parsing)
    // ----------------------------------------------------------------------------------
    // FIX #2: Remove SettingsInput entirely; hydrate directly
    useEffect(() => {
        latestSettingsRef.current = settings;
        latestUserRef.current = user;
        const workspaceChanged = latestWorkspaceIdRef.current !== activeWorkspaceId;
        if (workspaceChanged) {
            latestWorkspaceIdRef.current = activeWorkspaceId ?? null;
            hasHydratedWorkspaceRef.current = false;
            latestPatchRef.current = null;
            setSaveStatus("idle");
            setLastSavedAt(null);
            const seeded = withDetectedTimeZone({});
            latestFormDataRef.current = seeded;
            setFormData(seeded);
            setHydratedWorkspaceId(null);
            return;
        }
        if (!settings) {
            if (activeWorkspaceId && hydratedWorkspaceId !== activeWorkspaceId) {
                const seeded = withDetectedTimeZone({});
                latestFormDataRef.current = seeded;
                setFormData(seeded);
                hasHydratedWorkspaceRef.current = true;
                setHydratedWorkspaceId(activeWorkspaceId);
            }
            return;
        }
        if (!hasHydratedWorkspaceRef.current) {
            setFormData(settings);
            latestFormDataRef.current = settings;
            hasHydratedWorkspaceRef.current = true;
            setLastSavedAt(Date.now());
            setHydratedWorkspaceId(activeWorkspaceId);
        }
    }, [settings, activeWorkspaceId, user, hydratedWorkspaceId]);
    useEffect(() => {
        latestFormDataRef.current = formData;
    }, [formData]);
    useEffect(() => {
        latestUserRef.current = user;
    }, [user]);
    useEffect(() => {
        latestSettingsRef.current = settings;
    }, [settings]);
    useEffect(() => {
        saveStatusRef.current = saveStatus;
    }, [saveStatus]);
    useEffect(() => {
        isInitialSettingsSetupRef.current = isInitialSettingsSetup;
    }, [isInitialSettingsSetup]);
    // ----------------------------------------------------------------------------------
    // Section-level patch helpers
    // ----------------------------------------------------------------------------------
    // FIX #3: Replace SettingsInputType references with SettingsFormData
    function updateSection<K extends keyof SettingsFormData>(section: K, patch: Partial<SettingsFormData[K]>, behavior: SettingsChangeBehavior = "deferred") {
        lastChangeBehaviorRef.current = behavior;
        setFormData((prev) => {
            const currentSection = prev?.[section] ?? {};
            const nextSection = {
                ...(currentSection as object),
                ...(patch as object),
            };
            return {
                ...(prev ?? {}),
                [section]: nextSection,
            };
        });
    }
    function isDeferredInputTarget(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
        if (!(target instanceof HTMLElement)) {
            return false;
        }
        if (target instanceof HTMLTextAreaElement) {
            return true;
        }
        if (!(target instanceof HTMLInputElement)) {
            return false;
        }
        const deferredTypes = new Set([
            "text",
            "number",
            "date",
            "time",
            "email",
            "search",
            "tel",
            "url",
            "password",
        ]);
        const type = target.type || "text";
        return deferredTypes.has(type);
    }
    function handleTypedFieldFocusCapture(event: React.FocusEvent<HTMLDivElement>) {
        if (isDeferredInputTarget(event.target)) {
            typedInputFocusedRef.current = true;
        }
    }
    function handleTypedFieldBlurCapture(event: React.FocusEvent<HTMLDivElement>) {
        if (!isDeferredInputTarget(event.target)) {
            return;
        }
        const nextFocused = event.relatedTarget;
        if (isDeferredInputTarget(nextFocused)) {
            typedInputFocusedRef.current = true;
            return;
        }
        typedInputFocusedRef.current = false;
        if (debounceTimeoutRef.current) {
            clearTimeout(debounceTimeoutRef.current);
            debounceTimeoutRef.current = null;
        }
        if (isInitialSettingsSetupRef.current) {
            return;
        }
        if (saveStatusRef.current === "dirty" || saveStatusRef.current === "saving") {
            void persistSettings(latestFormDataRef.current, "autosave");
        }
    }
    // ----------------------------------------------------------------------------------
    // computePatch — field-level sparse diff
    // ----------------------------------------------------------------------------------
    // FIX #4: next parameter uses SettingsFormData
    function computePatch(prev: SettingsType | null, next: SettingsFormData): SettingsPatchType {
        if (!prev)
            return next as SettingsPatchType;
        const patch: SettingsPatchType = {};
        for (const section of ["common", "w2", "independent"] as const) {
            const before = prev[section] ?? {};
            const after = next[section] ?? {};
            const sectionPatch: Record<string, any> = {};
            for (const key of Object.keys(after) as (keyof typeof after)[]) {
                if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
                    sectionPatch[key] = after[key];
                }
            }
            if (Object.keys(sectionPatch).length > 0) {
                patch[section] = sectionPatch;
            }
        }
        return patch;
    }
    function validateCustomDeductions(nextFormData: SettingsFormData): string[] {
        const customDeductions = nextFormData.w2?.customDeductions ?? [];
        let hasError = false;
        customDeductions.forEach((d) => {
            const label = d.label?.trim() ?? "";
            const amount = d.amount;
            if (!label) {
                hasError = true;
            }
            if (amount == null || Number.isNaN(amount) || amount < 0) {
                hasError = true;
            }
        });
        const seen = new Map<string, number[]>();
        customDeductions.forEach((d, index) => {
            const key = (d.label ?? "").trim().toLowerCase();
            if (!key)
                return;
            if (!seen.has(key)) {
                seen.set(key, [index]);
                return;
            }
            seen.get(key)!.push(index);
        });
        for (const [, indices] of seen.entries()) {
            if (indices.length > 1) {
                hasError = true;
            }
        }
        return hasError
            ? ["Fix the errors in Additional Deductions before saving."]
            : [];
    }
    function validateRequiredSettings(nextFormData: SettingsFormData): string[] {
        if (activeWorkspace?.type !== "w2") {
            return [];
        }
        const errors: string[] = [];
        const payFrequency = nextFormData.w2?.payFrequency;
        const payPeriodStartDate = nextFormData.w2?.payPeriodStartDate?.trim();
        if (!payFrequency || !payPeriodStartDate) {
            if (!payFrequency) {
                errors.push("Choose your pay frequency.");
            }
            if (!payPeriodStartDate) {
                errors.push("Choose your pay period start date.");
            }
        }
        if (nextFormData.w2?.useHours) {
            const defaultHourlyRate = nextFormData.w2.defaultHourlyRate;
            const workInputMode = nextFormData.w2.workInputMode;
            if (defaultHourlyRate == null || Number.isNaN(defaultHourlyRate) || defaultHourlyRate <= 0) {
                errors.push("Add your default hourly rate for hourly income.");
            }
            if (!workInputMode) {
                errors.push("Choose your hour input mode for hourly income.");
            }
        }
        return errors;
    }
    function getSettingsValidationErrors(nextFormData: SettingsFormData): string[] {
        return [
            ...validateCustomDeductions(nextFormData),
            ...validateRequiredSettings(nextFormData),
        ];
    }
    function validateSettingsForm(nextFormData: SettingsFormData): string | null {
        return getSettingsValidationErrors(nextFormData)[0] ?? null;
    }
    function normalizePatch(patch: SettingsPatchType): SettingsPatchType {
        const normalized = { ...patch };
        for (const key in normalized) {
            if (Object.keys((normalized as any)[key] ?? {}).length === 0) {
                delete (normalized as any)[key];
            }
        }
        return normalized;
    }
    function hasAnySettingsInput(nextFormData: SettingsFormData): boolean {
        return ["common", "w2", "independent"].some((section) => Object.keys((nextFormData as any)[section] ?? {}).length > 0);
    }
    const currentValidationError = validateSettingsForm(formData);
    const currentValidationErrors = getSettingsValidationErrors(formData);
    const initialSetupValidationError = isInitialSettingsSetup
        ? currentValidationError
        : null;
    const hasInitialSettingsInput = hasAnySettingsInput(formData);
    const isInitialSetupReadyToSave = isInitialSettingsSetup &&
        hasInitialSettingsInput &&
        currentValidationErrors.length === 0;
    const isPrimarySaveDisabled = isInitialSettingsSetup
        ? isSaving
        : isSaving || saveStatus === "saved" || saveStatus === "idle";
    function computeSavePayload(nextFormData: SettingsFormData): {
        patch: SettingsPatchType;
        optimisticSettings: SettingsType | null;
    } {
        const sanitizedFormData = sanitizeFormDataForPersistence(nextFormData);
        let patch: SettingsPatchType;
        if (!settings) {
            patch = SettingsDocSchema.parse(sanitizedFormData) as SettingsPatchType;
        }
        else {
            const rawPatch = computePatch(settings, sanitizedFormData);
            patch = SettingsPatch.parse(rawPatch);
        }
        const normalizedPatch = normalizePatch(patch);
        const optimisticSettings = mergeSettings(settings, normalizedPatch) ??
            SettingsDocSchema.safeParse(sanitizedFormData).data ??
            null;
        return {
            patch: normalizedPatch,
            optimisticSettings,
        };
    }
    async function persistSettings(nextFormData: SettingsFormData, source: "autosave" | "manual" | "flush" = "autosave"): Promise<boolean> {
        if (persistPromiseRef.current) {
            if (isAndroidPlatform()) {
                debugLog("android-settings-save", "persist_skipped_inflight", {
                    source,
                    activeWorkspaceId: latestWorkspaceIdRef.current,
                });
            }
            if (source === "flush") {
                return await persistPromiseRef.current;
            }
            return false;
        }
        const run = async (): Promise<boolean> => {
            if (!user) {
                if (isAndroidPlatform()) {
                    debugError("android-settings-save", "persist_blocked_no_user", {
                        source,
                        activeWorkspaceId,
                        authLoading,
                    });
                }
                setSaveStatus("error");
                if (source === "manual") {
                    toast({
                        title: "Not signed in",
                        description: "You must be signed in to save settings.",
                        variant: "destructive",
                    });
                }
                return false;
            }
            if (!activeWorkspaceId) {
                if (isAndroidPlatform()) {
                    debugError("android-settings-save", "persist_blocked_no_workspace", {
                        source,
                        authLoading,
                    });
                }
                setSaveStatus("error");
                if (source === "manual") {
                    toast({
                        title: "Save failed",
                        description: "No active workspace selected.",
                        variant: "destructive",
                    });
                }
                return false;
            }
            const validationError = validateSettingsForm(nextFormData);
            if (validationError) {
                if (isAndroidPlatform()) {
                    debugError("android-settings-save", "persist_blocked_validation", {
                        source,
                        activeWorkspaceId,
                        validationError,
                    });
                }
                setSaveStatus("error");
                if (source === "manual") {
                    toast({
                        title: "Cannot save settings",
                        description: getSettingsValidationErrors(nextFormData).join(" "),
                        variant: "destructive",
                    });
                }
                return false;
            }
            const requestId = saveRequestIdRef.current + 1;
            saveRequestIdRef.current = requestId;
            activeSaveRequestRef.current = requestId;
            if (isAndroidPlatform()) {
                debugLog("android-settings-save", "persist_started", {
                    source,
                    requestId,
                    activeWorkspaceId,
                    hasUser: !!user,
                    authLoading,
                    patchPreviewSections: {
                        common: Object.keys(nextFormData.common ?? {}),
                        w2: Object.keys(nextFormData.w2 ?? {}),
                        independent: Object.keys(nextFormData.independent ?? {}),
                    },
                });
            }
            saveTraceRef.current = createProfileTrace("settings_save", {
                workspaceId: activeWorkspaceId,
                source,
            });
            saveTraceRef.current.mark("settings_save.tap", {
                source,
            });
            setIsSaving(true);
            setSaveStatus("saving");
            try {
                saveTraceRef.current.start("settings_save.patch_compute");
                const { patch, optimisticSettings } = computeSavePayload(nextFormData);
                saveTraceRef.current.end("settings_save.patch_compute");
                latestPatchRef.current = patch;
                if (Object.keys(patch).length === 0) {
                    if (isAndroidPlatform()) {
                        debugLog("android-settings-save", "persist_noop", {
                            source,
                            requestId,
                            activeWorkspaceId,
                        });
                    }
                    if (activeSaveRequestRef.current !== requestId) {
                        return false;
                    }
                    setIsSaving(false);
                    setSaveStatus("saved");
                    setLastSavedAt(Date.now());
                    return true;
                }
                saveTraceRef.current.mark("settings_save.local_ui_pending", {
                    patchSections: Object.keys(patch).length,
                    source,
                });
                if (optimisticSettings) {
                    saveTraceRef.current.start("settings_save.store_update");
                    updateSettingsStore(activeWorkspaceId, optimisticSettings);
                    saveTraceRef.current.end("settings_save.store_update", {
                        source: "optimistic",
                    });
                }
                const saved = await withProfileStep(saveTraceRef.current, "settings_save.save", () => settingsService.save(activeWorkspaceId, patch, {
                    trace: saveTraceRef.current
                        ? {
                            traceId: saveTraceRef.current.traceId,
                            flow: saveTraceRef.current.flow,
                        }
                        : null,
                }), { workspaceId: activeWorkspaceId });
                if (activeSaveRequestRef.current !== requestId) {
                    return false;
                }
                if (saved) {
                    saveTraceRef.current.start("settings_save.store_update");
                    updateSettingsStore(activeWorkspaceId, saved);
                    saveTraceRef.current.end("settings_save.store_update", {
                        source: "canonical",
                    });
                    if (isAndroidPlatform()) {
                        setFormData(saved);
                        latestFormDataRef.current = saved;
                    }
                }
                if (saved && activeWorkspace) {
                    void (async () => {
                        try {
                            await syncWorkspaceTimeEntryReminders(activeWorkspace, saved);
                        }
                        catch (error) {
                        }
                    })();
                    void syncWorkspaceGeofenceReminders(activeWorkspace, saved).catch(() => {
                    });
                }
                latestPatchRef.current = null;
                if (isAndroidPlatform()) {
                    debugLog("android-settings-save", "persist_succeeded", {
                        source,
                        requestId,
                        activeWorkspaceId,
                        savedSections: {
                            common: Object.keys(saved?.common ?? {}),
                            w2: Object.keys(saved?.w2 ?? {}),
                            independent: Object.keys(saved?.independent ?? {}),
                        },
                    });
                }
                setSaveStatus("saved");
                setLastSavedAt(Date.now());
                saveTraceRef.current.mark("settings_save.ui_success", {
                    workspaceId: activeWorkspaceId,
                    source,
                });
                saveTraceRef.current.mark("settings_save.complete", {
                    source,
                });
                return true;
            }
            catch (err: any) {
                if (isAndroidPlatform()) {
                    debugError("android-settings-save", "persist_failed", {
                        source,
                        requestId,
                        activeWorkspaceId,
                        message: err instanceof Error ? err.message : String(err),
                        stack: err instanceof Error ? err.stack ?? null : null,
                        status: typeof err?.status === "number" ? err.status : null,
                    });
                }
                if (activeSaveRequestRef.current === requestId) {
                    setSaveStatus("error");
                }
                saveTraceRef.current?.error("settings_save.failed", err);
                if (source !== "autosave" && source !== "flush") {
                    toast({
                        title: "Save failed",
                        description: err?.message ?? "Could not save settings.",
                        variant: "destructive",
                    });
                }
                return false;
            }
            finally {
                if (activeSaveRequestRef.current === requestId) {
                    setIsSaving(false);
                }
            }
        };
        const promise = run();
        persistPromiseRef.current = promise;
        try {
            return await promise;
        }
        finally {
            if (persistPromiseRef.current === promise) {
                persistPromiseRef.current = null;
            }
        }
    }
    // ----------------------------------------------------------------------------------
    // HANDLE SAVE
    // ----------------------------------------------------------------------------------
    const handleSave = async () => {
        setShowInitialValidationFeedback(true);
        debugLog("settings-page", "manual_save_clicked", {
            activeWorkspaceId,
            isInitialSettingsSetup,
            saveStatus,
            isSaving,
            hasAnySettingsInput: hasAnySettingsInput(latestFormDataRef.current),
            formSections: {
                common: Object.keys(latestFormDataRef.current.common ?? {}),
                w2: Object.keys(latestFormDataRef.current.w2 ?? {}),
                independent: Object.keys(latestFormDataRef.current.independent ?? {}),
            },
        });
        if (debounceTimeoutRef.current) {
            clearTimeout(debounceTimeoutRef.current);
            debounceTimeoutRef.current = null;
        }
        await persistSettings(formData, "manual");
    };
    const handleSaveAndContinue = async () => {
        setShowInitialValidationFeedback(true);
        if (debounceTimeoutRef.current) {
            clearTimeout(debounceTimeoutRef.current);
            debounceTimeoutRef.current = null;
        }
        setIsTransitioningToHome(true);
        const saved = await persistSettings(latestFormDataRef.current, "manual");
        if (!saved) {
            setIsTransitioningToHome(false);
            return;
        }
        router.replace("/app/home");
    };
    useEffect(() => {
        if (!activeWorkspaceId || !user || authLoading || workspaceState.status !== "ready") {
            if (isAndroidPlatform()) {
                debugLog("android-settings-save", "autosave_gate_blocked", {
                    reason: !activeWorkspaceId
                        ? "no_active_workspace"
                        : !user
                            ? "no_user"
                            : authLoading
                                ? "auth_loading"
                                : "workspace_not_ready",
                    activeWorkspaceId,
                    hydratedWorkspaceId,
                    hasUser: !!user,
                    authLoading,
                    workspaceStatus: workspaceState.status,
                });
            }
            return;
        }
        if (hydratedWorkspaceId !== activeWorkspaceId) {
            if (isAndroidPlatform()) {
                debugLog("android-settings-save", "autosave_gate_blocked", {
                    reason: "workspace_not_hydrated",
                    activeWorkspaceId,
                    hydratedWorkspaceId,
                });
            }
            return;
        }
        if (isInitialSettingsSetup) {
            debugLog("settings-page", "initial_setup_state_evaluated", {
                activeWorkspaceId,
                hydratedWorkspaceId,
                isInitialSettingsSetup,
                isSaving,
                hasAnySettingsInput: hasAnySettingsInput(formData),
                timeZone: formData.common?.timeZone ?? null,
                formSections: {
                    common: Object.keys(formData.common ?? {}),
                    w2: Object.keys(formData.w2 ?? {}),
                    independent: Object.keys(formData.independent ?? {}),
                },
            });
            if (!hasAnySettingsInput(formData)) {
                if (!isSaving) {
                    setSaveStatus("idle");
                }
                return;
            }
            setSaveStatus((current) => current === "saving" ? current : "dirty");
            return;
        }
        const validationError = validateSettingsForm(formData);
        if (validationError) {
            setSaveStatus("error");
            return;
        }
        let patch: SettingsPatchType;
        try {
            patch = computeSavePayload(formData).patch;
        }
        catch (error) {
            debugError("settings-page", "compute_save_payload_failed", {
                activeWorkspaceId,
                isInitialSettingsSetup,
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : null,
            });
            setSaveStatus("error");
            return;
        }
        latestPatchRef.current = patch;
        debugLog("settings-page", "save_patch_evaluated", {
            activeWorkspaceId,
            isInitialSettingsSetup,
            patchKeys: Object.keys(patch),
            patchSectionKeys: {
                common: Object.keys(patch.common ?? {}),
                w2: Object.keys(patch.w2 ?? {}),
                independent: Object.keys(patch.independent ?? {}),
            },
            isSaving,
        });
        if (Object.keys(patch).length === 0) {
            if (!isSaving) {
                setSaveStatus((current) => current === "error" ? "error" : "saved");
            }
            return;
        }
        if (!isSaving) {
            setSaveStatus("dirty");
        }
        if (lastChangeBehaviorRef.current === "immediate") {
            if (debounceTimeoutRef.current) {
                clearTimeout(debounceTimeoutRef.current);
                debounceTimeoutRef.current = null;
            }
            void persistSettings(formData, "autosave");
            return;
        }
        if (typedInputFocusedRef.current) {
            return;
        }
        if (debounceTimeoutRef.current) {
            clearTimeout(debounceTimeoutRef.current);
        }
        debounceTimeoutRef.current = setTimeout(() => {
            void persistSettings(formData, "autosave");
        }, 1000);
        return () => {
            if (debounceTimeoutRef.current) {
                clearTimeout(debounceTimeoutRef.current);
                debounceTimeoutRef.current = null;
            }
        };
    }, [
        formData,
        activeWorkspaceId,
        user,
        authLoading,
        workspaceState.status,
        hydratedWorkspaceId,
        isSaving,
        isInitialSettingsSetup,
    ]);
    useEffect(() => {
        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            if (saveStatusRef.current === "dirty" || saveStatusRef.current === "saving") {
                event.preventDefault();
                event.returnValue = "";
            }
        };
        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload);
            if (debounceTimeoutRef.current) {
                clearTimeout(debounceTimeoutRef.current);
                debounceTimeoutRef.current = null;
            }
            if (!latestPatchRef.current || Object.keys(latestPatchRef.current).length === 0) {
                return;
            }
            if (isInitialSettingsSetupRef.current) {
                return;
            }
            if (!latestWorkspaceIdRef.current || !latestUserRef.current) {
                return;
            }
            const optimisticSettings = mergeSettings(latestSettingsRef.current, latestPatchRef.current);
            if (optimisticSettings) {
                updateSettingsStore(latestWorkspaceIdRef.current, optimisticSettings);
            }
            void settingsService
                .save(latestWorkspaceIdRef.current, latestPatchRef.current)
                .then((saved) => {
                if (saved) {
                    updateSettingsStore(latestWorkspaceIdRef.current!, saved);
                }
            })
                .catch(() => {
            });
        };
    }, [updateSettingsStore]);
    useEffect(() => {
        setNavigationGuard({
            shouldBlock: isInitialSettingsSetup || saveStatus === "dirty" || isSaving,
            flush: async () => {
                debugLog("settings-page", "navigation_flush_requested", {
                    activeWorkspaceId,
                    isInitialSettingsSetup,
                    saveStatus,
                    isSaving,
                    hasPendingPatch: latestPatchRef.current != null &&
                        Object.keys(latestPatchRef.current).length > 0,
                });
                if (isInitialSettingsSetup) {
                    return false;
                }
                if (debounceTimeoutRef.current) {
                    clearTimeout(debounceTimeoutRef.current);
                    debounceTimeoutRef.current = null;
                }
                return persistSettings(latestFormDataRef.current, "flush");
            },
        });
        return () => {
            clearNavigationGuard();
        };
    }, [saveStatus, isSaving, isInitialSettingsSetup, setNavigationGuard, clearNavigationGuard]);
    useEffect(() => {
        debugLog("settings-page", "primary_save_button_state", {
            activeWorkspaceId,
            isInitialSettingsSetup,
            saveStatus,
            isSaving,
            isDisabled: isPrimarySaveDisabled,
            disableReasons: {
                isSaving,
                saved: !isInitialSettingsSetup && saveStatus === "saved",
                idle: !isInitialSettingsSetup && saveStatus === "idle",
                noInput: isInitialSettingsSetup && !hasInitialSettingsInput,
                validationError: isInitialSettingsSetup && initialSetupValidationError != null,
            },
            hasAnySettingsInput: hasInitialSettingsInput,
            initialSetupValidationError,
            currentValidationError,
            timeZone: formData.common?.timeZone ?? null,
            formSections: {
                common: Object.keys(formData.common ?? {}),
                w2: Object.keys(formData.w2 ?? {}),
                independent: Object.keys(formData.independent ?? {}),
            },
        });
    }, [
        activeWorkspaceId,
        isInitialSettingsSetup,
        saveStatus,
        isSaving,
        isPrimarySaveDisabled,
        hasInitialSettingsInput,
        initialSetupValidationError,
        currentValidationError,
        formData,
    ]);
    // ----------------------------------------------------------------------------------
    // LOADING STATE
    // ----------------------------------------------------------------------------------
    const hasRenderableSettingsScreen = activeWorkspaceId != null &&
        (settings !== null ||
            hydratedWorkspaceId === activeWorkspaceId ||
            hasAnySettingsInput(formData));
    const isSetupWorkspaceReady = Boolean(isSetupMode &&
        setupWorkspaceId &&
        workspaceState.status === "ready" &&
        activeWorkspaceId === setupWorkspaceId);
    if (authLoading ||
        workspaceState.status !== "ready" ||
        (!isSetupWorkspaceReady && settingsLoading && !hasRenderableSettingsScreen) ||
        !user) {
        return <AppLoader label="Loading settings..."/>;
    }
    if (isTransitioningToHome) {
        return <AppLoader label="We are configuring your settings" />;
    }
    if (isSetupMode && setupWorkspaceId && activeWorkspaceId !== setupWorkspaceId) {
        return <AppLoader label="Preparing your new workspace..."/>;
    }
    // ----------------------------------------------------------------------------------
    // RENDER
    // ----------------------------------------------------------------------------------
    return (<>
      {!isInitialSettingsSetup ? <StackInHeader /> : null}

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8" onFocusCapture={handleTypedFieldFocusCapture} onBlurCapture={handleTypedFieldBlurCapture}>
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Settings</h1>
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Workspace: {activeWorkspace?.type === "w2" ? "W-2" : "Independent"}
          </span>
        </div>

        {activeWorkspace?.type === "w2" && (<W2SettingsSection data={formData.w2} isInitialSetup={isInitialSettingsSetup} onChange={(patch, behavior) => updateSection("w2", patch, behavior)}/>)}

        {activeWorkspace?.type === "independent" && (<IndependentSettingsSection data={formData.independent} onChange={(patch, behavior) => updateSection("independent", patch, behavior)}/>)}

        <CommonSettingsSection data={formData.common} onChange={(patch, behavior) => updateSection("common", patch, behavior)}/>

        <div className="pt-4">
          {isInitialSettingsSetup &&
              showInitialValidationFeedback &&
              currentValidationErrors.length > 0 ? (<div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-medium">Finish these before continuing:</p>
              <ul className="mt-2 list-disc pl-5">
                {currentValidationErrors.map((error) => (<li key={error}>{error}</li>))}
              </ul>
            </div>) : null}
          <Button className={cn("w-full", isInitialSettingsSetup
                ? isInitialSetupReadyToSave
                    ? "bg-emerald-600 text-white hover:bg-emerald-600 focus-visible:ring-emerald-300 disabled:bg-emerald-600/75 disabled:text-white"
                    : "bg-slate-200 text-slate-700 hover:bg-slate-200 focus-visible:ring-slate-300 disabled:bg-slate-200 disabled:text-slate-700"
                : undefined)} onClick={isInitialSettingsSetup ? handleSaveAndContinue : handleSave} disabled={isPrimarySaveDisabled} variant={isInitialSettingsSetup
                ? "default"
                : saveStatus === "error"
                ? "destructive"
                : saveStatus === "dirty"
                    ? "default"
                    : "outline"}>
            {saveStatus === "error" && !isInitialSettingsSetup
                ? (isInitialSettingsSetup ? "Retry Save and Continue" : "Retry Save")
                : isSaving
                    ? "Saving..."
                    : isInitialSettingsSetup
                        ? "Save and Continue to Home"
                        : saveStatus === "dirty"
                    ? "Save Now"
                    : "Changes Saved Successfully"}
          </Button>
          {saveStatus === "dirty" || isSaving ? (<p className="mt-3 text-sm text-muted-foreground">
              {isInitialSettingsSetup
                    ? "Create your initial settings record before entering the app."
                    : "Changes save automatically."}
            </p>) : null}
          {saveStatus === "saved" && lastSavedAt ? (<p className="mt-3 text-sm text-muted-foreground">
              Last saved at {new Date(lastSavedAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                })}.
            </p>) : null}
          {saveStatus === "error" && !isInitialSettingsSetup ? (<p className="mt-3 text-sm text-destructive">
              {currentValidationError ?? "We could not save your latest changes. Retry when you are ready."}
            </p>) : null}
        </div>
      </div>

      <Dialog open={showWelcome} onOpenChange={setShowWelcome}>
        <DialogContent className="max-w-md text-center space-y-4">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">
              Welcome to StackIn!
            </DialogTitle>
            <DialogDescription>
              Configure your settings to start tracking your earnings
              accurately.
            </DialogDescription>
          </DialogHeader>
          <Button onClick={() => setShowWelcome(false)} className="w-full">
            Get Started
          </Button>
        </DialogContent>
      </Dialog>
    </>);
}
