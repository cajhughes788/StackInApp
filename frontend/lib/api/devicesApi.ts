import { tryWrite } from "@/lib/api/core/client"
import { API_ENDPOINTS } from "@/lib/api/core/endpoints"

export async function registerDeviceToken(
  fcmToken: string,
  platform: "ios" | "android" | "web",
  appVersion?: string
): Promise<void> {
  await tryWrite(API_ENDPOINTS.devices.registerToken, "POST", { fcmToken, platform, appVersion })
}
