# Android Build Notes

## Camera Permissions Issue

**Problem**: Tauri v2's `capabilities.json` permissions are not automatically merged into the generated `AndroidManifest.xml`.

**Manual Fix Required After `npm run tauri android init`:**

1. Edit `gen/android/app/src/main/AndroidManifest.xml`
2. Add the following permissions after the `INTERNET` permission:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
```

3. Edit `gen/android/app/build.gradle.kts`
4. Add cleartext traffic support to the release build type (around line 40):

```kotlin
getByName("release") {
    manifestPlaceholders["usesCleartextTraffic"] = "true"  // ADD THIS LINE
    isMinifyEnabled = true
    // ... rest of config
}
```

## Current Status

- ✅ CSP configured for camera access (`media-src 'self' data: mediastream:`)
- ✅ `capabilities.json` has all required permissions
- ⚠️  Manual AndroidManifest.xml edit required after each `android init`
- ⚠️  Manual build.gradle.kts edit required for cleartext traffic in release builds

## Why This Happens

Tauri v2 for Android is still maturing. The `capabilities.json` permissions configuration doesn't fully integrate with the Android build system yet.

## Future Improvement

Monitor Tauri v2 updates for automatic permission merging from `capabilities.json` to `AndroidManifest.xml`.
