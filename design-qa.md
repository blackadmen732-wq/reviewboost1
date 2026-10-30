# ReviewBoost owner launch visual QA

Source visual truth: `Branding/references/owner-app-launch-reference.jpg`, 726×1280 pixels, user-supplied phone mockup. Implementation: actual `apps/mobile/components/launch-screen.tsx`, rendered through react-native-web; screenshots in `docs/mobile/launch-screen/`.

State: startup/session restoration pending. Reference comparison normalizes the approximate 607×1208px screen interior to 390×776 CSS pixels (density 1); the full source's device frame/corners and system chrome are reference-only. Comparison evidence: `docs/mobile/launch-screen/reference-comparison.png`. Final larger-phone screenshot: `launch-390x844.png`. Additional checks: 320×568 and 430×932, density 1. This is component QA, not a native simulator/device capture.

## Fidelity surfaces

- Typography: app-owned content is the white brush-script raster wordmark and underline; no substituted live font. Spelling and capitalization remain ReviewBoost. The asset is a raster recreation of the provided photo, with minor contour differences; exact original vector equivalence is not claimed.
- Spacing/layout: centered contain-fit image, responsive width capped at 320pt on iOS/web. Native generated storyboard centers the same image. Source's image padding and perspective introduce a small apparent vertical difference; no forced startup delay or action control was introduced.
- Color/tokens: flat #005B3E background and white wordmark. The reference has photographic texture/shading; the native field is intentionally flat. Native RGB was verified in the generated color asset.
- Image quality: transparent recreated logo looks clean on the green field at phone size; generated retina assets have alpha and correct dimensions. No device chrome was baked into the asset. Wordmark contours are plainly readable in both 390px columns of the combined comparison, so separate zoom was not needed to assess their shape and underline.
- Copy/content: logo only, no added tagline, button or fake system indicators. Native OS supplies system UI. An accessibility label identifies the logo.

## Findings and history

No remaining actionable P0/P1/P2 visual defect in the **web-rendered launch component**. During asset preparation, transparent outputs looked noisy in the image tool's standalone display; rendering the actual first asset on green showed clean opacity and contours. This is asset inspection, not a claim of a native QA iteration.

The first preview harness did not give its web root a flex layout and consequently displayed the component at the top. Fixed the harness root to model native full-screen flex layout, then recaptured all four widths. Production `LaunchScreen` already had centered flex layout; no native code workaround was needed. Final comparison now shows centered artwork.

## Interaction and regression evidence

No launch buttons, no horizontal overflow or browser page exceptions in four captures. Unit tests exercise pending image readiness, immediate restored-screen handoff and all three existing destinations. Prebuild confirms native resources; iOS Hermes export confirms bundling. Native SDK/image events are mocked in unit tests. Console warnings were not treated as proof of native behavior.

## External verification

Physical iPhone cold/warm/offline launch, native status text, launch-to-JS continuity and TestFlight remain unverified. Linux cannot build/run Xcode here. No signed build, remote deployment or App Store submission was performed. See `docs/mobile/LAUNCH_SCREEN.md`.

## Follow-up polish

P3: if the original vector logo becomes available, replace the recreated raster with an export of that master while preserving the same startup composition. P3: reference perspective/texture is intentionally excluded from the flat native background.

final result: passed

This result applies only to the component's bounded visual comparison; native-device verification is still required.
