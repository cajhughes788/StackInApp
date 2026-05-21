# Android Play Store Release

This project ships to Android through the Capacitor app in `frontend/android`.

## Prerequisites

- Node.js 20 or newer for Capacitor 7 sync commands
- Java 21 runtime/JDK for the Android Gradle build
- Android SDK installed and referenced by `frontend/android/local.properties`

## Current Android identity

- App name: `StackIn`
- Package name: `app.stackin`
- Android source root: `frontend/android`

If the Play Store listing should use a different public app name or package ID, make that change before the first production upload. Package IDs are effectively permanent once the app exists in Google Play.

## 1. Set release metadata

Update the version values in `frontend/android/gradle.properties` before each Play Console upload:

```properties
STACKIN_ANDROID_VERSION_CODE=1
STACKIN_ANDROID_VERSION_NAME=1.0.0
```

- `STACKIN_ANDROID_VERSION_CODE` must increase on every upload.
- `STACKIN_ANDROID_VERSION_NAME` is the user-facing release version.

You can also override either value with environment variables of the same names in CI.

Android location reminder address entry no longer depends on a Google Maps or Places API key.

## 2. Create an upload keystore

Create an upload key once and keep it backed up safely:

```bash
keytool -genkeypair \
  -v \
  -keystore upload-keystore.jks \
  -alias upload \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

Then create `frontend/android/keystore.properties` from `frontend/android/keystore.properties.example`:

```properties
storeFile=/absolute/path/to/upload-keystore.jks
storePassword=replace-me
keyAlias=upload
keyPassword=replace-me
```

The Gradle build also supports these environment variables instead:

- `ANDROID_KEYSTORE_PATH`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

## 3. Build and sync the web assets

From the repo root:

```bash
npm run --workspace frontend sync
```

That performs a Next.js production build and syncs the Capacitor Android project.

## 4. Build the release bundle

From `frontend/android`:

```bash
./gradlew bundleRelease
```

Expected output:

```text
frontend/android/app/build/outputs/bundle/release/app-release.aab
```

For local device verification before upload, you can also run:

```bash
./gradlew assembleRelease
```

## 5. Play Console setup

In Google Play Console:

1. Create the app and choose the default language/app name.
2. Enroll in Play App Signing and keep the upload key backup.
3. Upload the `.aab` to an internal testing track first.
4. Add the store listing assets:
   - app icon
   - phone screenshots
   - feature graphic
   - short description
   - full description
5. Complete the App content forms.

## 6. Store review items for this app

This Android app currently declares:

- camera access
- fine and coarse location
- background location

Because background location is present for geofence reminders, expect Google Play to require:

- a clear in-app explanation of why location is needed in the background
- a matching privacy policy disclosure
- the Background Location permission declaration form in Play Console

If geofence reminders are not required for launch, removing background location will make review easier.

## 7. Suggested first release path

1. Confirm `StackIn` and `app.stackin` are the final Play identity.
2. Create the upload keystore.
3. Add the signing properties locally.
4. Build `app-release.aab`.
5. Upload to Internal testing.
6. Test install, auth, maps, camera, notifications, and geofence reminders on a physical Android device.
