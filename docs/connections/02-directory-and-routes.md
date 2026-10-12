# 2. Connections directory and route specification

**Status: PROPOSED.**

## 2.1 Where Connections lives

The owner navigation stays exactly as `features/dashboard/nav-items.ts`
defines it: Home, Feedback, Text Requests, Tags on the phone bar; the same
four plus Settings on desktop. That file's own comment says the phone bar "will
never hold five". The audit found no workflow that needs a new top-level
item, so none is added.

Connections is a row in **Settings**, between the business rows and Help:

```
Settings
  Business · Place · Google link · Signed in as
  ─────────────
  Connections            Square · Connected            >
  Billing                                              >
  ─────────────
  Help · Privacy · Delete account
```

Contextual entry points (doc 12 §12.6):

- **Text Requests**, recipient field: "Find a customer from Square" when a
  healthy connection exists; "Connect Square to find customers here" when none
  does. Never shown to `member` or `viewer` roles, who cannot connect.
- **Text Requests**, when the selected recipient's source connection needs
  attention: "Square needs attention. Fix it" linking to that connection.
- **Home** shows nothing about Connections unless a connection is in an error
  state, and then only as Home's single permitted warning
  (product-design rule "one warning, max", PR #67).

No Customers, Reviews, Praise, or Campaigns page is added. The existing
`/customers` page (anonymous visits, not in nav) is not reused for connected
contacts; connected contacts are reached from Text Requests, which is where an
owner needs them.

## 2.2 Routes

### Owner pages (Next.js App Router, `app/(owner)/settings/connections/…`)

| Route | Purpose | Roles |
|---|---|---|
| `/settings/connections` | Directory: search, categories, Connected / All tabs | owner, admin (read); others see 404 like other admin pages |
| `/settings/connections/[provider]` | Provider detail if not connected; connected detail if a connection exists for the selected location | owner, admin |
| `/settings/connections/[provider]/setup` | Setup wizard (steps 1–11 of doc 3 §3.4) | owner (admin if the owner allows, decision D-2.1) |
| `/settings/connections/[provider]/callback` | OAuth return landing page. Server-renders a "Finishing up…" state, then calls the callback API and redirects into the wizard | owner |

`[provider]` is a registry key (`square`), never a database id. The connection
id appears only in API calls, not in page URLs that might be shared or logged.

### API routes

Full contracts in doc 13. Summary:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/connections/providers` | Registry entries visible to this org, with availability and this org's connection state |
| GET | `/api/v1/connections` | This org's connections |
| GET | `/api/v1/connections/{connectionId}` | One connection, health, recent runs |
| POST | `/api/v1/connections/{provider}/authorize` | Begin authorization; returns the provider URL |
| POST | `/api/v1/connections/{provider}/callback` | Exchange code; validate state; create or update the connection |
| PUT | `/api/v1/connections/{connectionId}/configuration` | Location mapping and workflow selection |
| POST | `/api/v1/connections/{connectionId}/test` | Safe test sync (no writes to canonical records) |
| POST | `/api/v1/connections/{connectionId}/activate` | Activate after validation |
| POST | `/api/v1/connections/{connectionId}/sync` | Manual sync (rate limited) |
| POST | `/api/v1/connections/{connectionId}/disconnect` | Disconnect and revoke |
| GET | `/api/v1/connections/{connectionId}/runs` | Sync history |
| GET | `/api/v1/connections/{connectionId}/issues` | Records that could not be processed (redacted) |
| POST | `/api/v1/webhooks/integrations/square` | Square webhook receiver |
| POST | `/api/v1/internal/integrations/process` | Worker: drain inbox, run due syncs, refresh tokens |
| GET | `/api/v1/text-requests/recipients` | Search eligible-or-not recipients for the composer |
| POST | `/api/v1/text-requests/eligibility` | Explain eligibility for one recipient before sending |

## 2.3 The directory

### What appears

An entry appears only if it is in the **provider registry** (doc 4 §4.2),
which is code, reviewed in a diff. The registry's `availability` field decides
what the owner can do:

| Availability | Meaning | Owner sees | Action |
|---|---|---|---|
| `available` | Adapter implemented, configured in this environment (client id, secret, webhook key present), tests passing | Normal card | Connect |
| `in_setup` | Implemented but not configured in this environment, or behind a feature flag for pilot orgs | "Coming soon" | None, or "Tell me when it's ready" if D-2.2 is approved |
| `planned` | A row in Appendix A with no adapter | "Planned" | None |
| `unavailable` | Was available, turned off (outage, provider policy) | "Unavailable right now" plus reason | None; existing connections show their own state |

`available` is computed at request time: registry says implemented **and** the
environment has the credentials **and** the org passes the provider's feature
flag. A provider never renders a Connect button because a row says it should.

**Decision D-2.3:** whether to show `planned` entries at all. Recommendation:
show at most the three named in Appendix A (Toast, Clover, Vagaro), labelled
Planned, below the available ones. A directory with one card looks thin, but a
directory of greyed-out logos looks like a marketplace that does not work.
Hiding them entirely is also acceptable.

### Card contents

| Field | Square example |
|---|---|
| Name and logo | "Square", official logo from Square's brand assets, used as their brand guidelines allow (D-2.4: confirm before shipping) |
| One line | "Find customers from your Square sales or appointments." |
| Workflow | "Text a customer after their visit." |
| Data | "Customer names and phone numbers, and when they paid or had an appointment." |
| Direction | "Reads from Square. Never changes anything in Square." (one-way import plus events) |
| Availability | Available / Coming soon / Planned / Unavailable |
| Your status | Not connected · Connected · Needs attention · Syncing |
| Action | Connect · Manage · Fix · (none) |

Text is plain language for a salon or restaurant owner. "OAuth", "webhook",
"scope", "sync cursor" never appear in owner copy.

### Categories

Categories are product labels, not claims of support. A category with no
`available` or `planned` entry is not shown.

| Category | V1 entries |
|---|---|
| Point of sale | Square (available), Toast (planned), Clover (planned) |
| Appointments and bookings | Square Appointments (same Square connection), Vagaro (planned) |

"Customer management", "Business operations" and "Messaging providers" are
not shown in V1: there is nothing in them. Twilio is ReviewBoost's own provider,
not something an owner connects.

### Search

Client-side filter over the registry entries returned by
`/api/v1/connections/providers` (the list is small). Matches name, category
and a short keyword list per entry ("appointments", "pos", "salon").

### Connected view

A "Connected" tab lists this org's connections with location, health, last
successful sync, and Manage. If there are none, the tab is hidden rather than
empty.

## 2.4 Location scoping

A Square seller can have several locations; a ReviewBoost org can have up to
five (Pro). A connection belongs to one org and one provider account
(`merchant_id`), and carries a **location mapping**: each mapped Square
location points at exactly one ReviewBoost location. Unmapped Square locations
are ignored, and events from them are recorded as `skipped: location not
mapped`. One Square merchant may be connected to one ReviewBoost org at a
time; connecting it to a second org is refused (doc 4 §4.4).
