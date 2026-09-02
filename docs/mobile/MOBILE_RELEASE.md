# ReviewBoost Mobile — Release Engineering Runbook

Native release infrastructure for `apps/mobile` (Expo SDK 57 / React Native
0.86). This is the code/config side of shipping to TestFlight, the Apple App
Store, Google Play internal testing, and Google Play production.

Steps that require an Expo account, Apple/Google credentials, or physical
hardware are marked **[EXTERNAL]** and cannot be executed from CI or a
network-restricted agent. Everything else is validated in this repo and in the
`mobile-release-validation` CI workflow.

| Fact | Value |
| --- | --- |
| Expo SDK | `~57.0.14` |
| React Native | `0.86.2` |
| React | `19.2.3` |
| EAS CLI floor | `>= 16.0.0` (`eas.json` → `cli.version`) |
| App version source | `remote` (managed by EAS, not `app.json`) |
| iOS bundle identifier | `fit.reviewboost.app` |
| Android application id | `fit.reviewboost.app` |
| URL scheme / deep link | `reviewboost` |
| iOS deployment target | `16.4` (prebuild default for SDK 57) |
| Dev client | `expo-dev-client` `~57.0.13` (installed) |

---

## 1. EAS project & Expo account link **[EXTERNAL]**

The project is **not yet linked** to an EAS project — `app.json` has no
`extra.eas.projectId`, by design: linking requires an authenticated Expo
account (`api.expo.dev`), which is unreachable from CI/agents, and the project
ID must be *generated* by Expo, never invented.

Run once, locally, signed in to the ReviewBoost Expo account:

```bash
cd apps/mobile
npm i -g eas-cli          # or: npx eas-cli@latest
eas login                 # ReviewBoost Expo account
eas init                  # creates/links the EAS project for slug "reviewboost"
```

`eas init` **persists the generated project ID into `app.json`**:

```jsonc
{
  "expo": {
    "slug": "reviewboost",
    "owner": "<expo-account-or-org>",     // written by eas init
    "extra": { "eas": { "projectId": "<uuid>" } }  // written by eas init
  }
}
```

Commit that `app.json` change. Confirm ownership with `eas project:info`
(expect owner = the ReviewBoost Expo account/org, slug = `reviewboost`).

---

## 2. Environment variables (current EAS workflow)

`eas secret:create` is deprecated. Use **EAS Environment Variables**, scoped to
the `development` / `preview` / `production` environments that each `eas.json`
build profile is bound to via its `environment` field.

Only three variables exist, all `EXPO_PUBLIC_*` and therefore **compiled into
the client bundle — not secrets**:

| Variable | Value | Where set |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | `https://zoyqikgqfqulwkihjbev.supabase.co` | inline in `eas.json` (all profiles) |
| `EXPO_PUBLIC_API_URL` | `https://reviewboost.fit` | inline in `eas.json` (all profiles) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | production anon (publishable) key | EAS env var per environment |

The anon key is kept out of git and supplied per environment **[EXTERNAL]**:

```bash
eas env:create --environment production \
  --name EXPO_PUBLIC_SUPABASE_ANON_KEY \
  --value <production anon key> --visibility plaintext --type string
# repeat for --environment preview and --environment development
eas env:list --environment production
```

**Never** put `SUPABASE_SERVICE_ROLE_KEY`, Stripe secret keys (`sk_*`), the
customer-note encryption key, or the token-digest key into the mobile app or
any `EXPO_PUBLIC_*` name — they would ship to every device. CI
(`mobile-release-validation`) fails the build if any of these appear under
`apps/mobile`.

---

## 3. Build matrix **[EXTERNAL — needs EAS/credentials]**

All six builds run through EAS after §1 and §2 are done. Commands (from
`apps/mobile`):

| # | Target | Command | Status |
| --- | --- | --- | --- |
| 1 | iOS simulator dev build | `eas build -p ios --profile development` | prepared — dev profile has `ios.simulator: true`, `developmentClient: true` |
| 2 | Android dev/internal build | `eas build -p android --profile development` | prepared |
| 3 | iOS device preview build | `eas build -p ios --profile preview` | prepared — `preview.ios.simulator: false`, internal distribution |
| 4 | Android device preview build | `eas build -p android --profile preview` | prepared |
| 5 | iOS production (TestFlight) | `eas build -p ios --profile production` | prepared — `autoIncrement`, remote version |
| 6 | Android production AAB (Play) | `eas build -p android --profile production` | prepared |

First iOS build will prompt to create/allocate credentials (distribution cert,
provisioning profile) under the Apple account **[EXTERNAL]**. First Android
build will generate an upload keystore managed by EAS.

---

## 4. Store submission **[EXTERNAL — needs store credentials]**

`eas.json` `submit` profiles are configured; credentials are referenced by path
under the gitignored `apps/mobile/credentials/` directory and must be provided
locally / as EAS secrets:

- **Google Play**: `credentials/google-play-service-account.json` (a Play
  Console service account with the *Release to testing tracks* /
  *Release to production* permissions).
  - `eas submit -p android --profile preview` → **internal** track (draft)
  - `eas submit -p android --profile production` → **production** track
- **App Store Connect / TestFlight**: `credentials/asc-api-key.p8` plus the ASC
  API key id and issuer id (supply via `eas submit` prompts or EAS credentials).
  - `eas submit -p ios --profile production` → App Store Connect → TestFlight

Do **not** submit to public tracks without explicit authorization.

### Remaining Apple account actions [EXTERNAL]
- Enroll / confirm the Apple Developer Program team; note the Team ID.
- Create the App Store Connect app record for `fit.reviewboost.app` (get the
  `ascAppId`).
- Create an App Store Connect API key (Keys → App Store Connect API);
  download the `.p8` once → `credentials/asc-api-key.p8`; record key id + issuer id.
- Confirm the **Near Field Communication Tag Reading** capability is enabled on
  the App ID (prebuild already emits the `com.apple.developer.nfc.readersession.formats`
  entitlement; the capability must be toggled on the identifier).

### Remaining Google Play account actions [EXTERNAL]
- Create the Play Console app for `fit.reviewboost.app`.
- Create a service account, grant it release permissions, download the JSON →
  `credentials/google-play-service-account.json`.
- Complete the internal testing track setup and first manual upload if Play
  requires it before API submissions.

---

## 5. Native config validation (reproducible, no account needed)

`app.json` is a managed-workflow config; native directories are generated and
**not committed** (`.gitignore` ignores `/ios`, `/android`). To regenerate and
inspect what the build will produce:

```bash
cd apps/mobile
npm run prebuild:check    # expo prebuild --no-install --clean --platform all
```

Verified generated configuration (SDK 57 prebuild):

**iOS** (`ios/ReviewBoost/Info.plist`, `ios/ReviewBoost/ReviewBoost.entitlements`)
- `CFBundleDisplayName` / app name → `ReviewBoost`
- Bundle identifier → `fit.reviewboost.app`
- URL scheme → `reviewboost` (plus `fit.reviewboost.app`, `exp+reviewboost`)
- `NFCReaderUsageDescription` → present
- NFC entitlement `com.apple.developer.nfc.readersession.formats` → `["NDEF","TAG"]`
  (emitted by the `react-native-nfc-manager` config plugin)
- Keychain / SecureStore → `expo-secure-store` plugin
- `IPHONEOS_DEPLOYMENT_TARGET` → `16.4`; `supportsTablet: true`

**Android** (`android/app/src/main/AndroidManifest.xml`, `android/app/build.gradle`)
- `applicationId` → `fit.reviewboost.app`
- `<uses-permission android:name="android.permission.NFC" />`
- Deep-link `<data android:scheme="reviewboost" />`
- SecureStore backed by `expo-secure-store` (Android Keystore / EncryptedSharedPreferences)
- `versionCode` managed remotely by EAS (`appVersionSource: remote`,
  production `autoIncrement`)

> Note: no `<uses-feature android:name="android.hardware.nfc" android:required="true"/>`
> is emitted, which is intentional — NFC is used only by owners/admins to
> program tags, so the app stays installable on non-NFC devices.

### Known dependency drift (ahead of SDK-57 pins)

Four native modules sit slightly *ahead* of the versions Expo SDK 57 bundles.
They were chosen in the mobile foundation, pass typecheck / tests / prebuild,
and are reported by the CI audit as warnings (ahead, not behind):

| Package | Installed | SDK-57 bundled |
| --- | --- | --- |
| `@react-native-async-storage/async-storage` | `3.1.1` | `2.2.0` |
| `react-native-get-random-values` | `2.0.0` | `~1.11.0` |
| `react-native-screens` | `4.27.0` | `~4.26.0` |
| `react-native-safe-area-context` | `5.9.0` | `~5.7.0` |

Left as-is (forward bumps, not incompatibilities). Realign to the bundled
versions only if a native build surfaces a concrete problem.

---

## 6. NFC real-device gate **[EXTERNAL — hardware required]**

The software is **not NFC-verified until tested on real hardware**. The general
device checklist is in `docs/testing/NFC_DEVICE_TEST_CHECKLIST.md`; the
native-app write path (`apps/mobile/lib/nfc.ts`, driven from
`app/stand/[id].tsx`) must additionally pass, on a real iPhone (7+) and a real
NFC Android phone, with a dev or preview build (not Expo Go):

- [ ] **Role — can program**: signed in as **owner** → NFC write UI available and writes.
- [ ] **Role — can program**: signed in as **admin** → NFC write UI available and writes.
- [ ] **Role — cannot program**: signed in as **member** → write UI hidden ("Only owners and admins can write NFC tags").
- [ ] **Role — cannot program**: signed in as **viewer** → write UI hidden.
- [ ] **Blank NDEF tag** → classified `blank`, writes cleanly.
- [ ] **Existing ReviewBoost tag** (same URL) → classified `same-url`, no needless rewrite prompt.
- [ ] **Foreign content** (different URL / non-URL) → classified `different`, shows a **confirmation** before writing. Never silently overwrites.
- [ ] **Write** succeeds and returns success.
- [ ] **Fresh read-back verification** (`ndefHandler.getNdefMessage()`) confirms the written URL (`verified: true`).
- [ ] **Locked / read-only tag** → write fails with a clear error, no crash.
- [ ] **Write failure** (tag pulled mid-write) → clean error, session cancelled.
- [ ] **Timeout** (no tag presented) → cancels cleanly via `cancelTechnologyRequest()`.
- [ ] **Second-phone tap**: tapping the written tag with a *different* phone opens the tag URL.
- [ ] **Customer flow**: the written `https://reviewboost.fit/q/<opaque-token>` opens the star-rating → feedback → Google redirect flow.

---

## 7. Native auth verification **[EXTERNAL — device + live Supabase]**

Against the (now working) hosted Supabase Auth, on a real build
(`apps/mobile/data/auth-context.tsx`, `data/supabase.ts`):

- [ ] **6-digit OTP** — sign-in screen requests a 6-digit code (`signInWithOtp` → `verifyOtp`, `type: "email"`).
- [ ] **New user** — first-time email (`shouldCreateUser: true`) receives a code and signs in.
- [ ] **Returning user** — existing email receives a code and signs in.
- [ ] **Resend** — requesting a new code works.
- [ ] **Bad OTP** — wrong code shows "That code is not right", no session created.
- [ ] **Session persistence** — kill and reopen the app → still signed in (`persistSession`, `autoRefreshToken`).
- [ ] **SecureStore persistence** — session key material stored via `LargeSecureStore` (SecureStore + AsyncStorage), survives restart, not readable in plaintext.
- [ ] **Logout** — `signOut()` clears session and org state; app returns to sign-in.

---

## 8. CI

`.github/workflows/mobile-release-validation.yml` runs on any change under
`apps/mobile/**` and catches, without an Expo account:

- malformed `app.json` / `eas.json` (parse + required-key assertions)
- missing `EXPO_PUBLIC_*` variable names / drift between `.env.example` and `eas.json`
- native dependency incompatibility (`scripts/check-native-deps.js`, an
  offline audit against SDK 57 bundled versions: fails on any dependency
  *behind* the SDK-57 range, warns on ahead-of-pin bumps)
- TypeScript failures (`tsc --noEmit`)
- test failures (`vitest run`)
- accidental server secrets under `apps/mobile` (service-role key, `sk_*`, encryption/token-digest keys)
- invalid bundle / package identifiers (must be `fit.reviewboost.app`)
- `expo config` evaluation (config plugins resolve)
