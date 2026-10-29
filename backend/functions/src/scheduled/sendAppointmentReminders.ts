import { onSchedule } from "firebase-functions/v2/scheduler"
import { SENDGRID_API_KEY } from "../secrets"
import { sendDueAppointmentReminders } from "../services/appointmentRemindersService"

// Emails clients their reminders before confirmed appointments (up to two,
// at the times Booking setup picks), and pushes the owner when a client has
// no email. Every 15 minutes, so a 1-hour reminder lands on time.
export const sendAppointmentReminders = onSchedule(
  {
    schedule: "*/15 * * * *",
    timeZone: "America/Los_Angeles",
    region: "us-central1",
    secrets: [SENDGRID_API_KEY],
    // Emails go one at a time; leave room on a busy evening.
    timeoutSeconds: 540,
  },
  async () => {
    const { emailed, nudged } = await sendDueAppointmentReminders(new Date().toISOString())
    if (emailed > 0 || nudged > 0) console.info("sendAppointmentReminders: sent", { emailed, nudged })
  }
)
