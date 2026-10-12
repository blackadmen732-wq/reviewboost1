# 12. Privacy, security, compliance, and abuse-prevention checklist

**Status: PROPOSED.** Technical controls only. Not legal advice and not a
certification. Every item marked **Counsel** needs written legal review before
the related capability is enabled in production. SMS-specific controls are
owned by PR #76 doc 7 and doc 11 (threat model) and are referenced, not
restated.

## 12.1 Review integrity

- [ ] Every rating gets the identical destination; no code path reads the
      rating before the destination is chosen (existing contract test; extend
      to `/r/[ref]`).
- [ ] No eligibility, automation, report, or reminder rule reads
      `customer_responses.rating` to decide who is asked (pgTAP assertion on
      function bodies, as PR #76 doc 7 §7.6).
- [ ] Needs you filtering by rating affects only the owner's private inbox.
- [ ] Banned-copy lint over UI strings and email templates: "reviews
      generated", "reviews prevented", "intercept", "negative review",
      "review rate", "conversion".
- [ ] Templates contain no incentive language (no discount, gift, entry) and
      the only templates are the approved list.
- [ ] Integrity monitor (doc 6 §6.9) running.

## 12.2 Access control

- [ ] Every new table: RLS on, composite org FKs, no direct writes from
      `authenticated`, SECURITY DEFINER RPCs with `app.has_org_role`, audit in
      the same transaction.
- [ ] pgTAP cross-tenant attacks on every new table and RPC (read, write,
      assign to another org's member, read another org's snapshot).
- [ ] Assignment target must be an active member of the same org.
- [ ] Retention signals and cancellation feedback: service role and audited
      internal staff only; owners read only the evidence behind prompts shown
      to them.
- [ ] MFA step-up for enabling automation and for billing changes (APPROVED
      rule, `SYSTEM_CONTEXT.md` §9; MFA not built, F-5).
- [ ] Location-scoped admins: not in V1; reports and Feedback are org-wide for
      admins (D-12.2 if multi-location customers need it).

## 12.3 Customer privacy

- [ ] Customer anonymity on the rating page is preserved: the owner is never
      shown which text recipient gave which rating (decision 2).
- [ ] `/r/[ref]` reference: 128-bit random, stored only as keyed digest,
      single org, expires with the request's dedupe window (30 days), no PII in
      the URL.
- [ ] Owner emails and report snapshots contain aggregates only: no phone
      numbers, no last-four, no notes, no customer names.
- [ ] Notes remain encrypted; emails never quote a note.
- [ ] Analytics: `owner_activity_days` holds member id, day, surface bits; no
      URL, IP, user agent, or customer data.
- [ ] Email click tracking: **D-12.3**. Default proposal: Resend click
      tracking off; the email link goes through our own
      `/api/v1/r/email/{notification_id}` redirect that records `email_click`
      for the member and nothing else. Open tracking pixels off.
- [ ] Account deletion (PR #67) extended to new tables (doc 7 §7.7).
- [ ] Privacy policy updated for owner emails, activity records, and SMS
      attribution before launch. **Counsel**

## 12.4 Owner email compliance

- [ ] Transactional vs marketing classification for each category. Weekly
      summary, monthly report, reminders, billing, security: transactional/
      relationship. "Tips" category: treated as marketing (CAN-SPAM: physical
      address, unsubscribe honoured within 10 business days; we honour
      immediately). **Counsel** to confirm classification.
- [ ] One-click unsubscribe per category (List-Unsubscribe and
      List-Unsubscribe-Post headers).
- [ ] SPF, DKIM, DMARC on the sending domain.
- [ ] Bounce and complaint webhooks → `email_suppressions`.
- [ ] Non-US owners: not in scope; signup country is US-only in V1 or emails
      are held for review (D-12.4).

## 12.5 Customer SMS compliance (references)

- [ ] Consent with evidence and versioned wording (PR #76 doc 7 §7.4; Phase 0).
- [ ] Sender identification and "Reply STOP to opt out." (Phase 0).
- [ ] STOP/START/HELP phone-level (existing); HELP text (doc 5 §5.7). **Counsel**
- [ ] Quiet hours 09:00–20:00 location time, re-checked at dispatch (existing);
      state-law windows reviewed. **Counsel**
- [ ] Frequency cap 30 days per contact per org (PR #76 D-7.2).
- [ ] US numbers only in V1.
- [ ] A2P 10DLC brand and campaign registration; decide platform vs
      per-business registration (**D-12.1**, operations + Counsel).
- [ ] Automated sends (class B): written Counsel sign-off on consent basis
      for automated review requests (TCPA "autodialer" and state mini-TCPA
      exposure) before the flag can be enabled. **Counsel**

## 12.6 Security

- [ ] New internal endpoints require `workerAuthorized`; no public route can
      trigger a report, reminder, or evaluation.
- [ ] Email provider key server-only, no `NEXT_PUBLIC_` prefix (existing CI
      check covers it).
- [ ] Email provider fails closed in production when unconfigured, like
      `getSmsProvider`.
- [ ] Rendering: email templates escape all owner-supplied strings (business
      name, Tag label, location name).
- [ ] Rate limit the `/r/[ref]` route like `/q/[token]` (fail-closed limiter,
      existing).
- [ ] Logs: recursive redaction (existing) covers email addresses and refs.

## 12.7 Abuse prevention

| Abuse | Control |
|---|---|
| Owner texts people who never agreed | Attestation with evidence; per-org opt-out and complaint monitoring; `messaging_paused` hold (PR #76) |
| Owner uses Text Requests as marketing | Approved templates only; one purpose (`review_request`) |
| Owner fabricates ratings by tapping their own Tag | Existing rate limits; integrity monitor; reports say "ratings", never claim reviews |
| Incentivised reviews | Template whitelist; Terms prohibit; support can pause messaging |
| Review gating via owner behaviour (only texting happy customers) | Cannot be fully prevented technically; Terms prohibit; product never offers rating-based targeting; eligibility ignores sentiment |
| Staff misusing assignment or notes | Audit trail with names; owner can see all history |
| Email used to phish owners | DMARC, consistent sender, no login links that accept credentials from the email |

## 12.8 Data retention summary

See doc 7 §7.7. Report snapshots live with the org because they are the
business's record; everything else that is behavioural (activity, signals,
notifications) has a finite retention.
