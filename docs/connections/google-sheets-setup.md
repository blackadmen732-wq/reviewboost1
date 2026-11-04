# Google Sheets: setup and how it works

Settings → Connections → Google Sheets lets an owner bring in customers from a
Google Sheet they already keep.

## What happens

1. The owner taps **Choose a Google Sheet**. Google's own sign-in window opens
   and asks for one permission: *see the files you open with this app*
   (`drive.file`). That covers only the files the owner picks in this app,
   nothing else in their Drive.
2. Google's own file picker opens. The owner picks one sheet.
3. The browser reads that sheet (columns A–Z, up to 2,000 people) and guesses
   which columns hold the name and the phone. The owner can change the guess
   and sees the first rows before anything is saved.
4. **Add these people** sends the rows to `POST /api/v1/customers/lists`. The
   server normalises each phone number strictly, then stores it as a keyed
   digest plus ciphertext. A North American number must be 10 digits, or 11
   starting with 1, and anything else is reported back by row number, never
   guessed. Each usable row becomes a phone-keyed contact.
5. The browser revokes the Google permission. ReviewBoost keeps no Google
   credential. The server never sees one at all.

Adding the same sheet again updates those people instead of duplicating them.
**Remove** takes back the people only that sheet brought in. Anyone who also
came from somewhere else, or who has a visit, stays.

**Importing is not consent.** Nothing here records consent or texts anyone.
Whether a person may be texted is still decided only by the consent ledger
(doc 07).

## What you need to set up (once, by the account owner)

All of this is in one Google Cloud project, using the ReviewBoost business
Google account.

1. Go to <https://console.cloud.google.com> and create a project named
   `ReviewBoost`.
2. Go to **APIs & Services → Library** and enable **Google Sheets API** and
   **Google Picker API**.
3. Set up the **OAuth consent screen** (Google Auth Platform → Branding),
   which is the sign-in window owners see:
   - User type: **External**.
   - App name `ReviewBoost`, your support email, and your logo.
   - Add the privacy policy and terms links from the website.
   - Under **Data access**, add the scope
     `https://www.googleapis.com/auth/drive.file`.
   - While the app is in **Testing**, only the Google accounts you list as
     test users can sign in. Publish it to **Production** before real
     customers use it. `drive.file` is not one of Google's sensitive or
     restricted scopes, so it should not need Google's long security review,
     but Google decides that during publishing.
4. Go to **Credentials → Create credentials → OAuth client ID** and choose
   type **Web application**.
   - Under **Authorized JavaScript origins**, add your app's addresses, for
     example `https://app.yourdomain.com`, your Vercel preview domain, and
     `http://localhost:3000`.
   - No redirect URI is needed, because sign-in happens in Google's pop-up
     window.
   - Copy the **Client ID**.
5. Go to **Credentials → Create credentials → API key**.
   - Restrict it to **Websites**, using the same addresses as step 4.
   - Under API restrictions, allow only **Google Picker API**.
   - Copy the key.
6. Copy the **Project number** from **IAM & Admin → Settings**. It is the
   number, not the project ID.
7. Add these to Vercel under Project → Settings → Environment Variables.
   Don't paste them into a chat.
   - `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
   - `NEXT_PUBLIC_GOOGLE_API_KEY`
   - `NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER`
   - `SMS_DEFAULT_COUNTRY_CALLING_CODE=1`, if it isn't set already

These values are public by design: the browser uses them to open Google's
windows, and they grant nothing on their own. The restrictions in steps 4 and
5 are what stop someone else from using them on another site.

Until all four are set, the card says **Coming soon** and offers no sign-in.

## Logo

Put Google's official Sheets logo, from Google's brand resources and used
under its terms, at `frontend/public/connections/logos/google_sheets.svg`.
Without it, the card shows a plain sheet icon.

## Limits

- Up to 2,000 people per tab. Split a bigger list into tabs.
- Columns A–Z.
- 20 imports an hour per business.
- Only the sheet's title and a keyed digest of its id are kept. Rows that
  couldn't be used are reported to the owner once and are not stored.

## Files

| Piece | File |
|---|---|
| Table, functions, tests | `supabase/migrations/20261014000100_customer_list_imports.sql`, `supabase/tests/customer_lists_test.sql` |
| Server | `frontend/lib/server/customers/list-import.ts`, `frontend/app/api/v1/customers/lists/**` |
| Phone rule for lists | `normalizeListPhone` in `frontend/lib/server/integrations/normalize.ts` |
| Google in the browser | `frontend/lib/google/sheets-client.ts` |
| Column guessing | `frontend/features/connections/sheet-columns.ts` |
| Screen | `frontend/features/connections/google-sheets-import.tsx` |
| Unit tests | `frontend/tests/unit/customer-lists.test.ts` |

## CSV upload

Settings → Connections → Spreadsheet file (CSV) uses the same column check,
preview, import, re-import and removal as Google Sheets. The file is read in
the owner's browser; only names and phone numbers are sent, and only the
file's name is kept. Comma, semicolon and tab files from Excel, Numbers and
Google Sheets all work, including a title line above the header. It needs no
keys, only `SMS_DEFAULT_COUNTRY_CALLING_CODE`.
