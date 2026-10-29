import { onSchedule } from "firebase-functions/v2/scheduler"
import { refreshAllBusyCalendars } from "../services/busyCalendarsService"

// Re-reads every owner's busy calendars (their private iCal links) every 15
// minutes, so the booking page skips times they've just become busy.
export const refreshBusyCalendars = onSchedule(
  {
    schedule: "*/15 * * * *",
    timeZone: "America/Los_Angeles",
    region: "us-central1",
    // Calendars are read one at a time, each allowed up to 10 seconds.
    timeoutSeconds: 540,
  },
  async () => {
    const { read, failed } = await refreshAllBusyCalendars(new Date().toISOString())
    if (read > 0 || failed > 0) console.info("refreshBusyCalendars: done", { read, failed })
  }
)
