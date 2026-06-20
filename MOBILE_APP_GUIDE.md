# AcadFlow — Mobile App Guide

This covers two ways to run AcadFlow as a mobile app, both using the exact same code and design as the website (so functions never drift):

- **Part 1 — Install it today as an app (PWA).** No Mac, no Xcode, no app stores, no cost. Works on iPhone and Android in a few taps.
- **Part 2 — Build real native apps (Capacitor)** for the App Store / Play Store, or to sideload.

App URL: **https://acadflow-seven.vercel.app**

---

## Part 1 — Install now as an app (PWA)

The site is already a Progressive Web App: installed, it gets its own home-screen icon, runs full screen with no browser bars, works offline for cached screens, and supports notifications. Same screens, same functions as the website.

### iPhone / iPad (use Safari — this does not work in Chrome on iOS)

1. Open **Safari** and go to `acadflow-seven.vercel.app`.
2. Tap the **Share** button (the square with an up arrow, bottom center).
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add** (top right).
5. Open **AcadFlow** from your home screen. It now runs as a full-screen app.

### Android (Chrome)

1. Open **Chrome** and go to `acadflow-seven.vercel.app`.
2. Tap the **⋮** menu (top right).
3. Tap **Install app** (or **Add to Home screen**), then **Install**.
4. Open **AcadFlow** from your app drawer / home screen.

> Tip: when the app asks to allow notifications, tap **Allow** so messages and alerts can reach you. The app updates itself automatically whenever you open it online.

That's it — you have an installable app on both platforms right now, with zero build steps.

---

## Part 2 — Build native apps (Capacitor)

This wraps the same web build into true native iOS and Android projects you can run on a device or publish to the stores. The project is already configured (`capacitor.config.json` is in the repo: app id `app.acadflow.portal`, app name **AcadFlow**).

### What you need

- **Node.js** installed, and the repo cloned locally:
  `git clone https://github.com/markgalvez0725/acadflow.git`
- A **`.env`** file in the project root with your Firebase keys (copy `.env.example` and fill the `VITE_FB_*` values). This bakes Firebase into the build so the app connects on launch.
- **Android build:** [Android Studio](https://developer.android.com/studio) (free).
- **iOS build:** a **Mac** with **Xcode** (free) + an **Apple ID**. A free Apple ID installs to your own iPhone for 7 days; the **$99/yr** Apple Developer Program is needed for permanent installs and the App Store.

### One-time setup (run in the project folder)

```bash
npm install
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npm install @capacitor/splash-screen @capacitor/status-bar
npm run build            # creates the dist/ folder Capacitor ships
npx cap add android
npx cap add ios          # Mac only
npx cap sync
```

### Run / build Android

```bash
npx cap open android
```

In Android Studio:
- To test: pick a device or emulator and press **Run** (▶).
- To get an installable file: **Build → Build Bundle(s)/APK(s) → Build APK(s)**. The APK appears under `android/app/build/outputs/apk/`.
- For Play Store: **Build → Generate Signed Bundle / APK** and follow the signing wizard.

### Run / build iOS (Mac)

```bash
npx cap open ios
```

In Xcode:
- Select your iPhone (or a simulator) at the top.
- Click the project → **Signing & Capabilities** → set **Team** to your Apple ID.
- Press **Run** (▶) to install on the iPhone.
- For the App Store: **Product → Archive**, then upload from the Organizer.

### When the website changes

Refresh the native apps with:

```bash
npm run build
npx cap sync
```

> Alternative (always-live): instead of bundling, you can point the native shell at the live site so it never needs rebuilding. In `capacitor.config.json` add `"server": { "url": "https://acadflow-seven.vercel.app" }`, then `npx cap sync`. The app then mirrors the deployed website exactly. (Bundling, as set up above, is recommended because it also works when the shell is offline and is friendlier to App Store review.)

---

## Sideload without the stores (free)

- **Android:** copy the signed APK to your phone, open it, allow **Install unknown apps** when prompted. Done.
- **iOS:** install straight from Xcode to your own iPhone with a free Apple ID (the app stops opening after 7 days — just re-run from Xcode to renew), or join the Apple Developer Program ($99/yr) for a permanent install.

## Store fees (only if you publish)

- **Google Play:** $25 one-time.
- **Apple App Store:** $99/year.

---

## Notes & common pitfalls

- **White screen on launch:** you forgot `npm run build` or `npx cap sync`. Always run both after code changes.
- **Firebase not connecting:** make sure `.env` has your `VITE_FB_*` values before `npm run build`, or sign in once and enter the config in Admin → Settings → Firebase (it's saved encrypted on the device).
- **App icons / splash:** the icons in `/public` are used automatically; to regenerate every size, run `npm install @capacitor/assets` then `npx capacitor-assets generate`.
- **Native push notifications:** the web push we set up works in the PWA. For native (Capacitor) push, add `@capacitor/push-notifications` and wire APNs (iOS) / FCM (Android) — a follow-up I can do when you're ready. The in-app notification badges work everywhere already.

## Which should you use?

Start with the **PWA** today — it's instant, free, and identical to the website on both phones. Move to the **native build** only when you specifically need App Store / Play Store distribution. Both come from the same code, so there's nothing to keep in sync by hand.
