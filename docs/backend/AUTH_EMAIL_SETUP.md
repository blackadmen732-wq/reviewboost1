# Sign-in email setup

The login screen asks for a **six-digit code**. Getting that code to arrive is
the difference between a working product and one nobody can sign into, and it is
not the Supabase default.

---

## The problem the default has

Supabase's stock `magic_link` template contains only `{{ .ConfirmationURL }}` —
a link, no code. Sending it means the login screen asks for six digits that
never arrive. There is no error, no clue, and no way for the person to recover:
they tap the link, land in whatever browser their mail app uses, and their
session is created in a browser that is not the one with the login screen open.

This was verified by sending a real mail locally and reading it. The body had
zero six-digit codes in it.

## The fix, already applied

`supabase/config.toml`:

```toml
[auth.email.template.magic_link]
subject = "Your ReviewBoost sign-in code"
content_path = "./supabase/templates/magic-link.html"
```

The template leads with `{{ .Token }}` — the six-digit code — and keeps
`{{ .ConfirmationURL }}` underneath as a fallback. Both are the same one-time
credential, so a person who would rather tap a link still can.

Locally that is all there is to it. `supabase start` picks it up and mail lands
in Mailpit at **http://127.0.0.1:54324**.

---

## Production — the part that needs you

**Supabase's built-in email service is rate limited to a handful of messages per
hour and is explicitly not for production.** With it, the second or third owner
who signs up that hour simply never receives a code.

You need your own SMTP. Any of these work; Resend is the least friction:

| Provider | Free tier |
|---|---|
| Resend | 3,000/month |
| Postmark | 100/month, best deliverability |
| SendGrid | 100/day |
| Amazon SES | cheapest at volume, slowest to set up |

### Steps

1. **Verify a sending domain** with the provider — SPF and DKIM records on your
   DNS. Do not skip this. Mail from an unverified domain goes to spam, and a
   sign-in code in spam is the same as no sign-in code.

2. **Supabase Dashboard → Project Settings → Authentication → SMTP Settings.**
   Enter the host, port 587, username, and password. Set the sender address to
   something on the verified domain, not gmail.com.

3. **Authentication → Email Templates → Magic Link.** Paste the contents of
   `supabase/templates/magic-link.html`. The dashboard does not read the local
   file — this step is manual and easy to forget, and forgetting it means
   production sends links while development sends codes.

4. **Authentication → Providers → Email.** Confirm "Enable email provider" is
   on and "Confirm email" is off. Leaving confirmation on adds a second email
   before anyone can do anything.

5. **Send yourself one.** Sign in with a real address on a real phone. Check it
   arrives, check it is not in spam, and check the code is readable at arm's
   length.

### Rate limits worth setting

Dashboard → Authentication → Rate Limits:

- **Email sends per hour** — the ceiling on how fast someone can burn your
  sending quota by pasting addresses into the login box.
- **Token verifications** — bounds guessing a six-digit code. Six digits is a
  million combinations, which is plenty *only* while attempts are limited.

---

## Verifying it works

```bash
# Local
curl -s -X POST "$SUPABASE_URL/auth/v1/otp" \
  -H "apikey: $SUPABASE_ANON_KEY" -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","create_user":true}'

# Then read it at http://127.0.0.1:54324 and confirm a six-digit code is
# present. If you see only a link, the template did not load.
```

In production the same call should be followed by a real email within seconds.
If it takes minutes, deliverability is not set up properly and it will get worse
under load, not better.

---

## What is still missing

- **No custom domain on the link.** The fallback URL points at the Supabase
  project host, which looks unfamiliar in a mail client. Configure a custom auth
  domain before launch.
- **No email for anything else.** No receipts, no notifications, no "you have
  unread feedback" digest. All later.
- **Deliverability is unmonitored.** Nobody would know if codes stopped
  arriving; the first signal would be owners saying they cannot sign in.
