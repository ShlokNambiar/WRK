# WRK — Build & Release (Capacitor → Play Store)

WRK is a Vite + React web app wrapped with Capacitor for Android.
- App ID: `life.pepl.wrk`   ·   App name: `WRK`   ·   Web build dir: `dist/`

## Daily dev (web)
```bash
npm run dev        # http://localhost:5174  (live reload, fastest loop)
```

## Update the native app after any code change
```bash
npm run build      # web → dist/
npx cap copy android   # copy dist/ into the Android project
# (use `npx cap sync android` instead if you added/removed a Capacitor plugin)
```

## Build & run on a device/emulator
Requires **Android Studio** (bundles the Android SDK). Not installed yet on this machine.
1. Install Android Studio → it sets up the SDK + creates `android/local.properties`.
2. ```bash
   npx cap open android      # opens the project in Android Studio
   ```
3. In Android Studio: pick a device/emulator → Run.

CLI alternative once the SDK is installed:
```bash
npx cap run android
```

## Release build (signed .aab for Play Store)
1. Create an upload keystore (once, keep it SAFE — losing it means you can't update the app):
   ```bash
   keytool -genkey -v -keystore wrk-upload.keystore -alias wrk \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
2. In Android Studio: **Build → Generate Signed Bundle / APK → Android App Bundle**,
   select the keystore, build the **release** `.aab`.
   (Output: `android/app/release/app-release.aab`)
3. Upload that `.aab` to the Play Console.

## Play Store submission checklist
- [ ] Google Play Console account ($25 one-time): https://play.google.com/console
- [ ] App content: privacy policy URL, data-safety form, content rating, target audience
- [ ] Store listing: title, short + full description, **feature graphic (1024×500)**,
      **min 2 phone screenshots**, app icon (512×512)
- [ ] Set up app signing (let Google manage the app signing key; you keep the upload key)
- [ ] Internal testing track first → then closed/open testing → production
- [ ] First production review can take a few days; new accounts may need 14-day closed
      testing with 12+ testers before they can publish to production (current Google policy)

## Notes
- `haptics.js` and `native.js` auto-detect the native shell and no-op on web.
- Fonts are bundled (`@fontsource/newsreader`) so the app works fully offline.
