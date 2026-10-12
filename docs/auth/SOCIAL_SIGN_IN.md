# Continue with Apple / Continue with Google

Owners can sign in with Apple or Google on the web, in addition to the email
code. Email sign-in is unchanged and is always shown. Each provider button
appears only when its switch is on, so nobody sees a button that can't work.

Status: **code is in place, and both providers are off.** Nothing here has been
tried against real Apple or Google credentials yet. The steps below have to be
done by someone with access to the accounts involved.

## How it works

```
/login  ──"Continue with Apple|Google"──▶  supabase.auth.signInWithOAuth (PKCE)
        ──▶ Apple / Google sheet ──▶ https://<project>.supabase.co/auth/v1/callback
        ──▶ {site}/auth/callback?code=…&next=…  (frontend/app/auth/callback/route.ts)
        ──▶ exchangeCodeForSession ──▶ next (re-validated with safeInternalPath)
```

- The session cookies are the same ones the email code sets, so `requireOwner`,
  organization membership, roles and RLS don't change.
- `next` (the page the owner was trying to reach) survives the round trip. The
  callback checks it again and never follows it off-site.
- When the owner cancels the sheet, they land on `/login?error=cancelled`, with a
  calm notice and every option still there.
- When the exchange fails or the code expired, they land on
  `/login?error=failed|expired` with an alert. The log line is
  `auth.oauth_exchange_failed` and carries only a reason, never a token, code
  or email.
- A brand-new owner has no organization, so they go to `/onboarding` as before.

| File | Role |
|---|---|
| `frontend/lib/auth/oauth-providers.ts` | Provider switches, redirect URL, error codes and messages |
| `frontend/features/auth/oauth-buttons.tsx` | The two buttons (provider-styled; see below) |
| `frontend/features/auth/sign-in-flow.tsx` | Email first, then "or", then Apple, then Google; Cancel |
| `frontend/app/auth/callback/route.ts` | Code exchange and every failure path |
| `frontend/features/auth/provider-account-notice.tsx` | Onboarding notice for Apple/Google sign-ins (see *Existing owners*) |

## Existing owners: no lost businesses, no silent merges

Supabase links an Apple or Google sign-in to an existing account **only when
the provider returns the same email, verified**. Automatic linking needs no
setting: manual linking stays off (`enable_manual_linking = false`), and the
app never links accounts itself.

| Owner signs in with… | Result |
|---|---|
| Google, same address they used for the email code | Same account, same business. |
| Apple, sharing their real email (same address) | Same account, same business. |
| Apple with **Hide My Email** (`…@privaterelay.appleid.com`) | A **new, empty** account. |
| A different Google account / address | A **new, empty** account. |

In the last two cases the owner would land on setup and could create a second
copy of their business. `ProviderAccountNotice` sits above setup for any
Apple/Google sign-in. It says plainly that this is a new account (and why, for
Hide My Email) and offers **Sign out**, so they can come back with the email
they used before. Nothing is merged, moved or deleted.

## Button design

- **Apple:** black, white logo, "Continue with Apple". On a dark page it
  becomes white with a black logo. This follows Apple's Human Interface
  Guidelines for Sign in with Apple: same size as the other options, and listed
  before them.
- **Google:** white with a grey outline, the four-colour "G", and "Continue with
  Google". On a dark page it becomes dark grey (`#131314`). These are the
  colours from Google's sign-in branding guidelines.
- The Apple glyph is drawn inline (Simple Icons path), not taken from Apple's
  downloadable asset kit. Before an App Store or marketing review, compare it
  with Apple's official assets
  (developer.apple.com/design/resources → Sign in with Apple) and swap in the
  official SVG if it differs.

"Continue with Google" is **only sign-in**. It doesn't connect a Google
Business Profile, and it doesn't read or create a review link.

## Turning on Google (web)

Needs: access to a Google Cloud project, and to the Supabase project's
dashboard.

1. In Google Cloud Console → *APIs & Services* → *OAuth consent screen*:
   - App name: ReviewBoost.
   - Support email.
   - Scopes: `openid`, `email`, `profile` only.
   - Authorized domains: `reviewboost.fit` and `supabase.co`.
   - Publish the app. While it's in "Testing", only listed test users can sign
     in.
2. *Credentials* → *Create OAuth client ID* → **Web application**:
   - Authorized JavaScript origins: `https://reviewboost.fit`.
   - Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
3. In Supabase dashboard → *Authentication* → *Sign In / Providers* → *Google*:
   paste the Client ID and Client secret, then enable.
4. In Supabase → *Authentication* → *URL Configuration* → *Redirect URLs*, add:
   - `https://reviewboost.fit/auth/callback`
   - the preview origin's `/auth/callback`, if previews should allow it
5. Set `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=true` in that deployment's environment
   and redeploy. The flag is read at build time.
6. Test on the real deployment:
   - A new Google account lands on setup with the notice.
   - An existing owner's Google account with the same email lands on Home with
     their business.
   - Closing the Google window comes back to "Sign-in was cancelled".

## Turning on Apple (web)

Needs: a **paid Apple Developer Program membership** (Account Holder or Admin
role), and access to the Supabase dashboard.

1. In Certificates, Identifiers & Profiles → *Identifiers*:
   - The App ID `fit.reviewboost.app` needs the **Sign in with Apple**
     capability enabled.
   - Create a **Services ID** (for example `fit.reviewboost.web`). This is the
     web "client ID".
   - Enable Sign in with Apple on the Services ID. Configure it with:
     - primary App ID `fit.reviewboost.app`
     - domain `<project-ref>.supabase.co`
     - return URL `https://<project-ref>.supabase.co/auth/v1/callback`
2. *Keys* → create a key with Sign in with Apple. Download the `.p8` **once**,
   and note the Key ID and your Team ID.
3. Generate the client secret: a JWT signed with that key. Supabase's Apple
   provider page links to a generator.
   **This secret expires after at most 6 months.** Put a calendar reminder to
   regenerate it, or Apple sign-in stops working.
4. In Supabase → *Sign In / Providers* → *Apple*:
   - Client IDs: the Services ID, plus `fit.reviewboost.app` once the iOS app
     uses native sign-in.
   - Secret: the JWT.
   - Enable.
5. Redirect URLs: same as step 4 of Google.
6. **Private email relay:** in *Services* → *Sign in with Apple for Email
   Communication*, register `reviewboost.fit` and `no-reply@reviewboost.fit`.
   Without that, any email ReviewBoost sends to a Hide My Email owner
   (receipts, notices) is dropped by Apple's relay.
7. Set `NEXT_PUBLIC_AUTH_APPLE_ENABLED=true` and redeploy.
8. Test on a real device and browser (Safari on an iPhone, and a desktop
   browser):
   - Hide My Email on and off.
   - Cancel.
   - An existing owner who shares their real email.

## Local development

`supabase/config.toml` has the Apple and Google blocks (`enabled = false`), and
`/auth/callback` is in `additional_redirect_urls` for `127.0.0.1:3000` and
`localhost:3000`. To try a provider locally:

1. Use your own test OAuth client, with redirect URI
   `http://127.0.0.1:54321/auth/v1/callback`.
2. Set `client_id`, export `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` (or the Apple
   one) and set `enabled = true`. Don't commit the client ID change.
3. Run `supabase_cli stop && supabase_cli start`.
4. Set `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=true` in `frontend/.env.local`.

Apple doesn't allow `http://` or `localhost` return URLs, so Apple web sign-in
can only be tested on a hosted HTTPS project.

## Not built yet: native sign-in in the mobile app

`apps/mobile` still uses only the email code. Nothing in this change touches it.
Before adding Apple or Google there:

- **Apple:** `expo-apple-authentication` (needs `ios.usesAppleSignIn: true` and a
  development build, not Expo Go). Pass the identity token and a hashed nonce to
  `supabase.auth.signInWithIdToken({ provider: "apple", token, nonce })`. Add
  `fit.reviewboost.app` to the Apple provider's Client IDs.
- **Google:** `@react-native-google-signin/google-signin`, with iOS and Android
  OAuth clients plus the web client ID. Then call
  `signInWithIdToken({ provider: "google", token })`.
- **App Store Review Guideline 4.8:** if the iOS app offers Google sign-in, it
  must also offer Sign in with Apple, or an equivalent private option.
- **Account deletion (5.1.1(v)):** in-app deletion already exists. For owners
  who signed in with Apple, Apple also expects the app to **revoke the Apple
  token** on deletion (Sign in with Apple REST API `/auth/revoke`). That is not
  implemented. Treat it as a gate before shipping Apple sign-in in the iOS app.
- All of this needs a physical iPhone and Android phone to verify. Simulators
  don't exercise the real Apple ID sheet reliably.

## What has been verified, and what hasn't

Verified in this repository:

- Unit and component tests:
  - `tests/unit/oauth-providers.test.ts`
  - `tests/unit/auth-callback-route.test.ts`
  - `tests/component/sign-in-flow.test.tsx`
  - `tests/component/provider-account-notice.test.tsx`
- A real browser against `next dev`:
  - Clicking "Continue with Apple" requests
    `/auth/v1/authorize?provider=apple&redirect_to=…/auth/callback?next=%2Ftags&code_challenge=…&code_challenge_method=s256`.
  - The email Continue still posts to `/auth/v1/otp`.
  - Tab order is Cancel → email → Continue → Apple → Google → privacy.
  - With both switches off, no provider buttons render and the email field has
    focus.
  - Layout checked at 320, 375, 390 and 1280 px, in light and dark.

Not verified (needs credentials, dashboard access or a device):

- A completed Apple or Google sign-in end to end.
- Identity linking against a real existing owner.
- Hide My Email delivery.
- Safari on iOS.
- Anything in the mobile app.
