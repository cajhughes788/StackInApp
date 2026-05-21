import { z } from "zod"

export const EntryReminderDeliveryMode = z.enum(["always", "if_no_entry"])

export const TimeEntryReminder = z.object({
  id: z.string(),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  enabled: z.boolean(),
  deliveryMode: EntryReminderDeliveryMode.optional(),
})

export const LocationEntryReminder = z.object({
  id: z.string(),
  label: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  address: z.string(),
  radiusMeters: z.number(),
  trigger: z.enum(["arrive", "leave"]),
  enabled: z.boolean(),
  deliveryMode: EntryReminderDeliveryMode.optional(),
})

/* -------------------------------------------------------
 * COMMON SETTINGS — fully optional, sparse
 * -----------------------------------------------------*/

export const CommonSettings = z.object({
  timeZone: z.string().optional(),
  autoEntryReminders: z.boolean().optional(),
  reminderType: z.string().optional(),
  reminderTime: z.string().optional(),
  entryRemindersEnabled: z.boolean().optional(),
  timeEntryReminders: z.array(TimeEntryReminder).optional(),
  locationEntryReminders: z.array(LocationEntryReminder).optional(),

  reminderLocation: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      address: z.string(),
      radiusMeters: z.number(),
    })
    .nullable()
    .optional(),

  notificationId: z.number().optional(),
  geofenceId: z.string().optional(),
  notifications: z.boolean().optional(),
  useNotes: z.boolean().optional(),
})

/* -------------------------------------------------------
 * W2 SETTINGS — required only for UI-critical fields
 * -----------------------------------------------------*/

export const W2Settings = z.object({
  // UI requires knowing which input mode to show
  workInputMode: z.enum(["enter_hours", "enter_in_out_times"]).optional(),

  // UI must know if employee is tipped in order to show fields
  isTippedEmployee: z.boolean().optional(),

  // These are optional user preferences
  useHours: z.boolean().optional(),
  defaultHourlyRate: z.number().optional(),
  autoBreakDeduction: z.boolean().optional(),
  breakMinutesDefault: z.number().optional(),

  askCardTips: z.boolean().optional(),
  askReportedCash: z.boolean().optional(),
  askUnreportedCash: z.boolean().optional(),
  includeUnreportedInUI: z.boolean().optional(),

  autoTaxCalculation: z.boolean().optional(),
  taxProfile: z.any().nullable().optional(),
  incomeTargetPerPeriod: z.number().optional(),

  // Pay period logic requires these to function
  payFrequency: z.enum(["weekly", "biweekly", "semi-monthly", "monthly"]).optional(),
  payPeriodStartDate: z.string().optional(),

  // Must NOT use defaults, sparse DB only
  customDeductions: z
    .array(
      z.object({
        label: z.string(),
        amount: z.number(),
      })
    )
    .optional(),
})

/* -------------------------------------------------------
 * INDEPENDENT SETTINGS — only operationally required fields
 * -----------------------------------------------------*/

export const IndependentSettings = z.object({
  // UI must know if hours are tracked or not
  trackHours: z.boolean().optional(),

  // UI must know if independent tips exist
  isTippedIndependent: z.boolean().optional(),

  // Optional toggles
  askCardTips: z.boolean().optional(),
  askReportedCash: z.boolean().optional(),
  askUnreportedCash: z.boolean().optional(),
  includeUnreportedInUI: z.boolean().optional(),

  // Payment channel toggles — required to render UI correctly
  enableVenmo: z.boolean().optional(),
  enableApplePay: z.boolean().optional(),
  enableZelle: z.boolean().optional(),
  enablePosSales: z.boolean().optional(),
  enableCashSales: z.boolean().optional(),
  trackBusinessMileage: z.boolean().optional(),
  incomeTargetPerMonth: z.number().optional(),
  expenseTargetPerMonth: z.number().optional(),
  // Sparse — no defaults!
  customIncomeFields: z
    .array(
      z.object({
        label: z.string(),
      })
    )
    .optional(),
})

/* -------------------------------------------------------
 * SETTINGS DOCUMENT (FIRESTORE)
 * -----------------------------------------------------*/

export const SettingsDocSchema = z.object({
  common: CommonSettings.optional(),
  w2: W2Settings.optional(),
  independent: IndependentSettings.optional(),
})

export type SettingsType = z.infer<typeof SettingsDocSchema>

/* -------------------------------------------------------
 * PATCH SCHEMA (partial updates)
 * -----------------------------------------------------*/

export const SettingsPatch = z.object({
  common: CommonSettings.partial().optional(),
  w2: W2Settings.partial().optional(),
  independent: IndependentSettings.partial().optional(),
})

export type SettingsPatchType = z.infer<typeof SettingsPatch>

/* -------------------------------------------------------
 * MODE → SCHEMA mapping
 * -----------------------------------------------------*/

export type SettingsMode = "w2" | "independent"

export const BranchSchemaByMode: Record<
  SettingsMode,
  typeof W2Settings | typeof IndependentSettings
> = {
  w2: W2Settings,
  independent: IndependentSettings,
}
export type CommonSettingsType = z.infer<typeof CommonSettings>
export type W2SettingsType = z.infer<typeof W2Settings>
export type IndependentSettingsType = z.infer<typeof IndependentSettings>
export type TimeEntryReminderType = z.infer<typeof TimeEntryReminder>
export type LocationEntryReminderType = z.infer<typeof LocationEntryReminder>
export type EntryReminderDeliveryModeType = z.infer<typeof EntryReminderDeliveryMode>
