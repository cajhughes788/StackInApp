import { Capacitor } from "@capacitor/core"

export type NativeReceiptImageSource = "camera" | "photos"

type CameraPermissionState =
  | "prompt"
  | "prompt-with-rationale"
  | "granted"
  | "denied"
  | "limited"

type CameraPermissionStatus = {
  camera: CameraPermissionState
  photos: CameraPermissionState
}

function getPermissionDeniedMessage(source: NativeReceiptImageSource): string {
  if (source === "camera") {
    return "Camera access is turned off. Enable camera access for StackIn in your device Settings, then try again."
  }

  return "Photo library access is turned off. Enable Photos access for StackIn in your device Settings, then try again."
}

function isPermissionGranted(
  source: NativeReceiptImageSource,
  status: CameraPermissionStatus
): boolean {
  const permission = source === "camera" ? status.camera : status.photos
  if (source === "photos") {
    return permission === "granted" || permission === "limited"
  }

  return permission === "granted"
}

async function ensureCapturePermission(
  source: NativeReceiptImageSource,
  camera: {
    checkPermissions(): Promise<CameraPermissionStatus>
    requestPermissions(input: {
      permissions: Array<"camera" | "photos">
    }): Promise<CameraPermissionStatus>
  }
): Promise<void> {
  const permissionName = source === "camera" ? "camera" : "photos"
  const current = await camera.checkPermissions()
  if (isPermissionGranted(source, current)) {
    return
  }

  const currentPermission =
    source === "camera" ? current.camera : current.photos
  if (currentPermission === "denied") {
    throw new Error(getPermissionDeniedMessage(source))
  }

  const requested = await camera.requestPermissions({
    permissions: [permissionName],
  })

  if (!isPermissionGranted(source, requested)) {
    throw new Error(getPermissionDeniedMessage(source))
  }
}

function normalizeCaptureError(error: unknown): Error {
  if (error instanceof Error) {
    if (/cancel/i.test(error.message)) {
      return new Error("Receipt capture was canceled.")
    }

    if (
      /OS-PLUG-CAMR-0003/i.test(error.message) ||
      /OS-PLUG-CAMR-0005/i.test(error.message) ||
      /access wasn't provided/i.test(error.message) ||
      /user denied/i.test(error.message) ||
      /permission/i.test(error.message)
    ) {
      return error
    }

    return error
  }

  return new Error("Unable to open the device camera.")
}

export function isNativeCameraAvailable(): boolean {
  return Capacitor.isNativePlatform()
}

export async function captureReceiptImage(
  source: NativeReceiptImageSource
): Promise<File | null> {
  if (!isNativeCameraAvailable()) {
    return null
  }

  try {
    const { Camera, CameraResultType, CameraSource } = await import(
      "@capacitor/camera"
    )

    await ensureCapturePermission(source, Camera)

    const photo = await Camera.getPhoto({
      source:
        source === "camera" ? CameraSource.Camera : CameraSource.Photos,
      resultType: CameraResultType.Uri,
      quality: 90,
      correctOrientation: true,
      presentationStyle: "fullscreen",
      saveToGallery: false,
    })

    if (!photo.webPath) {
      throw new Error("The device did not return a receipt image.")
    }

    const response = await fetch(photo.webPath)
    const blob = await response.blob()
    const mimeType = blob.type || "image/jpeg"
    const extension =
      mimeType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "jpg"
    const fileName =
      photo.path?.split("/").pop() || `receipt-${Date.now()}.${extension}`

    return new File([blob], fileName, {
      type: mimeType,
      lastModified: Date.now(),
    })
  } catch (error) {
    if (error instanceof Error && /cancel/i.test(error.message)) {
      return null
    }

    throw normalizeCaptureError(error)
  }
}
