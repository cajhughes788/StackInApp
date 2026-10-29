import { getWithMeta, setWithMeta, clearKeysWithMeta } from "./metadata"
import { safeSchemaParse } from "@/lib/utils/safeSchemaParse"
import { CACHE_VERSIONS } from "./cacheVersions"
import { AppointmentSchema, type AppointmentType } from "@shared/schemas/appointment"

// The last appointments list from the server, so Booking shows at once on
// the next launch while a fresh copy loads.

function appointmentsKey(workspaceId: string): string {
  return `workspaces::${workspaceId}::appointments`
}

export async function readAppointmentsCache(workspaceId: string): Promise<AppointmentType[] | null> {
  const rec = await getWithMeta<AppointmentType[]>(appointmentsKey(workspaceId), {
    expectedVersion: CACHE_VERSIONS.appointments,
  })
  if (!rec?.data) return null
  const parsed = safeSchemaParse(AppointmentSchema.array(), rec.data)
  return parsed.success ? parsed.data : null
}

export async function saveAppointmentsCache(workspaceId: string, appointments: AppointmentType[]): Promise<void> {
  await setWithMeta<AppointmentType[]>(appointmentsKey(workspaceId), appointments, {
    version: CACHE_VERSIONS.appointments,
  })
}

export async function clearAppointmentsCache(workspaceId?: string): Promise<void> {
  if (!workspaceId) {
    await clearKeysWithMeta((key) => key.endsWith("::appointments"))
    return
  }
  await clearKeysWithMeta((key) => key === appointmentsKey(workspaceId))
}
