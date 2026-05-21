"use client";
import { useEffect, useState } from "react";
import { Globe, Pencil } from "lucide-react";
import { NativePlacePicker, type PlaceSuggestion } from "@/plugins/NativePlacePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { debugError, debugLog } from "@/lib/debugLoop";
type PickedLocation = {
    lat: number;
    lng: number;
    address: string;
    name?: string;
};
type WebLocationSuggestion = {
    id: string;
    address: string;
    name?: string;
    placeId?: string;
    lat?: number;
    lng?: number;
};
export function NativeLocationPicker({ value, onSelect, onError, onBeforePick, }: {
    value?: string;
    onSelect: (loc: PickedLocation) => void;
    onError?: (message: string) => void;
    onBeforePick?: () => Promise<boolean | void>;
}) {
    const prefersNativePicker = NativePlacePicker.isNativeAvailable();
    const [loading, setLoading] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [searching, setSearching] = useState(false);
    const [suggestions, setSuggestions] = useState<WebLocationSuggestion[]>([]);
    const { toast } = useToast();
    const isAndroidInlineSearch = NativePlacePicker.isAndroidNativeSearchAvailable();
    useEffect(() => {
        if (prefersNativePicker || !searchOpen) {
            return;
        }
        const trimmed = query.trim();
        if (trimmed.length < 3) {
            setSuggestions([]);
            setSearching(false);
            return;
        }
        setSearching(true);
        const controller = new AbortController();
        let disposed = false;
        const timeoutId = window.setTimeout(async () => {
            try {
                const results = await NativePlacePicker.searchPlaces(trimmed, 6);
                if (controller.signal.aborted) {
                    return;
                }
                setSuggestions(results.map((item: PlaceSuggestion, index) => ({
                    id: item.placeId
                        ? `${item.placeId}:${index}`
                        : `${item.lat ?? "na"}:${item.lng ?? "na"}:${index}`,
                    address: item.address,
                    name: item.name,
                    placeId: item.placeId,
                    lat: item.lat,
                    lng: item.lng,
                })));
                debugLog("location-picker", "search_results_loaded", {
                    query: trimmed,
                    resultCount: results.length,
                    provider: isAndroidInlineSearch
                        ? "android-inline-hybrid"
                        : "browser",
                });
            }
            catch (error) {
                if ((error as Error).name === "AbortError") {
                    return;
                }
                const message = error instanceof Error
                    ? error.message
                    : "Unable to search locations right now.";
                debugError("location-picker", "search_results_failed", {
                    query: trimmed,
                    message,
                    provider: isAndroidInlineSearch
                        ? "android-inline-hybrid"
                        : "browser",
                });
                onError?.(message);
            }
            finally {
                if (!disposed && !controller.signal.aborted) {
                    setSearching(false);
                }
            }
        }, 250);
        return () => {
            disposed = true;
            controller.abort();
            window.clearTimeout(timeoutId);
        };
    }, [isAndroidInlineSearch, onError, query, searchOpen]);
    async function handleNativePick() {
        try {
            setLoading(true);
            const canProceed = await onBeforePick?.();
            if (canProceed === false)
                return;
            debugLog("location-picker", "native_picker_opened", {});
            const result = await NativePlacePicker.pickPlace();
            if (!result) {
                toast({
                    title: "Location not changed",
                    description: "No location was selected.",
                });
                return;
            }
            onSelect(result);
        }
        catch (err) {
            const message = err instanceof Error
                ? err.message
                : "Location access failed. Please try again.";
            debugError("location-picker", "native_picker_failed", {
                message,
            });
            onError?.(message);
            toast({
                title: "Unable to choose location",
                description: message,
                variant: "destructive",
            });
        }
        finally {
            setLoading(false);
        }
    }
    async function handleBrowserPick() {
        try {
            setLoading(true);
            const canProceed = await onBeforePick?.();
            if (canProceed === false)
                return;
            if (isAndroidInlineSearch) {
                await NativePlacePicker.resetSearchSession();
            }
            setQuery(value && value !== "Pick a location" ? value : "");
            setSuggestions([]);
            setSearchOpen(true);
            debugLog("location-picker", "search_opened", {
                hadExistingValue: !!(value && value !== "Pick a location"),
            });
        }
        catch (err) {
            const message = err instanceof Error
                ? err.message
                : "Location access failed. Please try again.";
            debugError("location-picker", "search_open_failed", {
                message,
            });
            onError?.(message);
            toast({
                title: "Unable to choose location",
                description: message,
                variant: "destructive",
            });
        }
        finally {
            setLoading(false);
        }
    }

    async function handleCurrentLocationPick() {
        try {
            setLoading(true);
            const canProceed = await onBeforePick?.();
            if (canProceed === false)
                return;
            debugLog("location-picker", "current_location_requested", {});
            const result = await NativePlacePicker.pickPlace();
            if (!result) {
                return;
            }
            onSelect(result);
            setSearchOpen(false);
        }
        catch (err) {
            const message = err instanceof Error
                ? err.message
                : "Unable to access your current location.";
            debugError("location-picker", "current_location_failed", {
                message,
            });
            onError?.(message);
            toast({
                title: "Unable to use current location",
                description: message,
                variant: "destructive",
            });
        }
        finally {
            setLoading(false);
        }
    }

    async function handleWebSuggestionSelect(suggestion: WebLocationSuggestion) {
        try {
            setLoading(true);
            let resolved: PickedLocation | null = suggestion.lat != null && suggestion.lng != null
                ? {
                    lat: suggestion.lat,
                    lng: suggestion.lng,
                    address: suggestion.address,
                    name: suggestion.name,
                }
                : null;

            if (!resolved && suggestion.placeId) {
                resolved = await NativePlacePicker.resolvePlace(suggestion.placeId);
            }

            if (!resolved) {
                throw new Error("Unable to resolve the selected location.");
            }

            debugLog("location-picker", "search_result_selected", {
                name: resolved.name ?? suggestion.name ?? null,
                address: resolved.address,
                lat: resolved.lat,
                lng: resolved.lng,
                placeId: suggestion.placeId ?? null,
            });

            onSelect({
                lat: resolved.lat,
                lng: resolved.lng,
                address: resolved.address,
                name: resolved.name ?? suggestion.name,
            });
            setQuery(resolved.address);
            setSuggestions([]);
            setSearchOpen(false);
        }
        catch (error) {
            const message = error instanceof Error
                ? error.message
                : "Unable to use that location right now.";
            debugError("location-picker", "search_result_resolution_failed", {
                message,
                placeId: suggestion.placeId ?? null,
            });
            onError?.(message);
            toast({
                title: "Unable to choose location",
                description: message,
                variant: "destructive",
            });
        }
        finally {
            setLoading(false);
        }
    }
    return (<div className="space-y-2">
      <Button type="button" variant="outline" disabled={loading} onClick={() => {
            if (prefersNativePicker) {
                void handleNativePick();
                return;
            }
            void handleBrowserPick();
        }} className="w-full justify-between">
        <span className="truncate">
          {value && value !== "Pick a location" ? value : "Choose Location"}
        </span>
        {value && value !== "Pick a location" ? (<Pencil className="h-4 w-4 shrink-0"/>) : (<Globe className="h-4 w-4 shrink-0"/>)}
      </Button>

      {!prefersNativePicker && searchOpen ? (<div className="space-y-3 rounded-md border border-border bg-card p-3">
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1" disabled={loading} onClick={() => {
            void handleCurrentLocationPick();
        }}>
              Use Current Location
            </Button>
            <Button type="button" variant="ghost" className="px-3" onClick={() => {
            setSearchOpen(false);
            if (isAndroidInlineSearch) {
                void NativePlacePicker.resetSearchSession();
            }
        }}>
              Close
            </Button>
          </div>

          <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a business, workplace, or address"/>

          {searching ? (<p className="text-sm text-muted-foreground">Searching nearby matches...</p>) : null}

          {suggestions.length > 0 ? (<div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
              <div className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                {isAndroidInlineSearch ? "Nearby Matches" : "Matches"}
              </div>
              <div className="max-h-72 overflow-y-auto">
                {suggestions.map((suggestion) => (<button key={suggestion.id} type="button" className="block w-full border-b border-border px-3 py-3 text-left transition-colors last:border-b-0 hover:bg-accent" disabled={loading} onClick={() => {
                void handleWebSuggestionSelect(suggestion);
            }}>
                  <div className="truncate text-sm font-medium text-foreground">
                    {suggestion.name ?? suggestion.address}
                  </div>
                  {suggestion.name ? (<div className="truncate text-xs text-muted-foreground">
                      {suggestion.address}
                    </div>) : null}
                </button>))}
              </div>
              {isAndroidInlineSearch ? (<div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                  Google Maps
                </div>) : null}
            </div>) : null}
        </div>) : null}
    </div>);
}
