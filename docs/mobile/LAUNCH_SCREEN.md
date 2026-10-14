# Owner app launch — 14 October 2026

The supplied green iPhone mockup is saved verbatim at [Branding/references/owner-app-launch-reference.jpg](../../Branding/references/owner-app-launch-reference.jpg). Its white handwritten ReviewBoost wordmark was recreated with Image Gen into `apps/mobile/assets/launch-wordmark.png` (1964×801, transparent). This is a launch-specific raster recreation, not an exact vector master or a replacement for the canonical R/Geist brand assets. No photographed phone, notch, clock, signal icons or home indicator is shipped as app content.

## Behavior

`app.json` configures `expo-splash-screen`: flat #005B3E, contain fit, centered 320pt iOS image, light iOS launch status bar. Android uses 180dp to fit its system icon safe region. The native root view and actual `LaunchScreen` share the same artwork/background. Initial iOS status text is white; React Native restores dark status text when the light app screen mounts. The app remains light-themed, so no unnecessary dark launch override is configured.

`app/_layout.tsx` retains the native launch until the JS logo finishes loading or the first restored screen lays out. The loading state uses the same component, without timers, buttons, artificial minimum display duration or an extra route. `app/index.tsx` keeps the existing destinations: signed out → login; signed in without selected organization → business picker; selected business → Live Feed. Existing bounded session restoration prevents an indefinite network wait; a restoration error is now visible on the initial email sign-in screen. Organization loading/retry still belongs to the existing picker.

The old unreferenced transparent one-pixel launch image was removed after searching its callers. Backend, customer rating flow, billing, messaging, app icon and everyday logo are unchanged.

## Verification

- Fresh frozen-lockfile mobile install restored the previously absent splash package; no dependency or lockfile change.
- TypeScript passed. Mobile suite: **115 tests / 15 files passed**, including pending/ready launch handoff and existing redirect destinations. Native SDK/image events are mocked in unit tests; these do not prove actual device behavior.
- Existing canonical brand tests: **18 passed**.
- Production-profile managed prebuild passed and restored package manifests. Generated iOS storyboard has centered contain-fit logo, exact RGB (0,91,62), light initial status text and 320/640/960px alpha image assets. Android resources generated; its existing compileSdkVersion auto-detection warning remains an Android build caveat.
- iOS Hermes export passed (one bundle plus logo asset). Compile-only placeholder public endpoints were used; no live API, billing or messaging operation was exercised.
- The actual `LaunchScreen` was rendered through react-native-web at 320×568, 390×776, 390×844 and 430×932. Preview harness substitutes the native `require` image resource with the **identical PNG URI** and supplies the web root layout. No page exceptions, horizontal overflow or extra buttons. This is web-rendered component evidence, not an iPhone screenshot.
- [Reference comparison](launch-screen/reference-comparison.png), [390×844 preview](launch-screen/launch-390x844.png), [render checks](launch-screen/render-checks.json), [generated-native checks](launch-screen/native-generation-checks.json). Root `design-qa.md` scopes its visual result to the rendered component.

## Next native build

This native launch configuration requires a **new signed iOS build** through the existing EAS production/preview profile or Xcode, followed by installation/TestFlight. A web push or JavaScript-only update does not replace the installed native launch storyboard. No remote build, submission or deployment was started here.

Physical iPhone verification remains required: cold/warm launch, fast/slow/offline session restoration, native-to-JS image alignment, status-bar transition, login recovery and active-business routing. iOS may cache launch artwork; assess a freshly installed build before diagnosing a stale launch image. Android's system splash mask and signed build also remain unverified on hardware.
