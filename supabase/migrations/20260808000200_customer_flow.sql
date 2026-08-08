-- ReviewBoost customer flow
--
-- The five anonymous endpoints under /api/v1/public/q/:token.
--
-- REVIEW INTEGRITY
-- ----------------
-- Nothing in this file stores, reads, or derives a rating threshold. Every
-- rating from 1 to 5 is stored in `customer_responses`, and the Google
-- opportunity belongs to the *location*, not to the rating. The private note
-- and Team Praise are additive: extra things a customer may do, never a
-- substitute for the public review.
--
-- If a future migration adds a column that makes any customer-facing value
-- depend on `rating`, that migration is wrong.

create type public.team_praise_status as enum ('unmatched', 'matched', 'archived');
create type public.idempotency_state as enum ('in_progress', 'completed');

-- ------------------------------------------------- public sessions --------

create table public.public_review_sessions (
    id                 uuid primary key default gen_random_uuid(),
    org_id             uuid not null references public.organizations (id) on delete cascade,
    location_id        uuid not null,
    stand_id           uuid not null,

    -- Keyed digest of the opaque token handed to the customer, never the token.
    -- The token is a capability: holding it is the only thing that authorises
    -- writing into this business, so a database disclosure must not yield a
    -- usable one.
    session_token_hash text not null unique,

    locale             text not null check (locale ~ '^[a-z]{2}(-[A-Za-z0-9]{2,8})?$'),

    -- Keyed, rotating hash of coarse network and device data, for short-term
    -- abuse control only. Never a raw address, and never customer identity:
    -- every customer in one restaurant shares an address, so treating this as a
    -- person would merge them all into one.
    client_hash        text,

    expires_at         timestamptz not null,
    created_at         timestamptz not null default now(),

    constraint public_review_sessions_id_org_key unique (id, org_id),
    constraint public_review_sessions_stand_fk
        foreign key (stand_id, org_id) references public.review_stands (id, org_id) on delete cascade,
    constraint public_review_sessions_location_fk
        foreign key (location_id, org_id) references public.locations (id, org_id) on delete cascade
);

create index public_review_sessions_org_location_time_idx
    on public.public_review_sessions (org_id, location_id, created_at desc);
create index public_review_sessions_stand_time_idx
    on public.public_review_sessions (stand_id, created_at desc);
create index public_review_sessions_expiry_idx on public.public_review_sessions (expires_at);

-- ----------------------------------------------- customer responses -------

create table public.customer_responses (
    id                  uuid primary key default gen_random_uuid(),
    org_id              uuid not null references public.organizations (id) on delete cascade,
    location_id         uuid not null,
    stand_id            uuid not null,
    session_id          uuid not null,

    response_token_hash text not null unique,

    -- Every rating is stored. A 4 or a 5 is not a "conversion" that skips
    -- storage, and a 1 is not diverted anywhere.
    rating              smallint not null check (rating between 1 and 5),

    -- Optional for every rating, including 4 and 5. Encrypted by the
    -- application with AES-256-GCM; the key version travels with the row so a
    -- key rotation does not orphan old ciphertext.
    note_encrypted      text,
    note_key_version    smallint not null default 1,

    submitted_at        timestamptz not null default now(),
    read_at             timestamptz,
    resolved_at         timestamptz,
    created_at          timestamptz not null default now(),

    -- One logical response per session.
    constraint customer_responses_session_key unique (session_id),
    constraint customer_responses_id_org_key unique (id, org_id),
    constraint customer_responses_session_fk
        foreign key (session_id, org_id)
        references public.public_review_sessions (id, org_id) on delete cascade,
    constraint customer_responses_stand_fk
        foreign key (stand_id, org_id) references public.review_stands (id, org_id) on delete cascade,
    constraint customer_responses_location_fk
        foreign key (location_id, org_id) references public.locations (id, org_id) on delete cascade
);

create index customer_responses_org_location_time_idx
    on public.customer_responses (org_id, location_id, submitted_at desc);
create index customer_responses_unread_idx
    on public.customer_responses (org_id, submitted_at desc)
    where read_at is null;

-- -------------------------------------------------- google clicks ---------

-- Records that the customer *selected* the Google action.
--
-- It has never meant, and must never be reported as meaning, that a review was
-- written, submitted, or published, or that a rating changed on Google.
-- ReviewBoost cannot observe any of those things. Any metric built on this
-- table must be named for the selection, not for an outcome.
create table public.google_review_clicks (
    id          uuid primary key default gen_random_uuid(),
    org_id      uuid not null references public.organizations (id) on delete cascade,
    location_id uuid not null,
    response_id uuid not null,
    clicked_at  timestamptz not null default now(),
    created_at  timestamptz not null default now(),

    constraint google_review_clicks_response_key unique (response_id),
    constraint google_review_clicks_response_fk
        foreign key (response_id, org_id)
        references public.customer_responses (id, org_id) on delete cascade,
    constraint google_review_clicks_location_fk
        foreign key (location_id, org_id) references public.locations (id, org_id) on delete cascade
);

create index google_review_clicks_org_location_time_idx
    on public.google_review_clicks (org_id, location_id, clicked_at desc);

-- ---------------------------------------------------- team praise ---------

-- Deliberately carries no rating column and no Google state.
--
-- The owner decides recognition without seeing the star rating that happened to
-- accompany it. Keeping the column out of the table means the barrier holds
-- even if a future query forgets to exclude it — a column that does not exist
-- cannot be selected into a DTO by accident.
create table public.team_praise_records (
    id                     uuid primary key default gen_random_uuid(),
    org_id                 uuid not null references public.organizations (id) on delete cascade,
    location_id            uuid not null,
    response_id            uuid not null,

    first_name_encrypted   text not null,
    praise_note_encrypted  text,
    encryption_key_version smallint not null default 1,

    -- Matching is always a human decision, in a later phase. ReviewBoost never
    -- guesses which colleague the customer meant.
    status                 public.team_praise_status not null default 'unmatched',
    matched_staff_id       uuid,
    matched_by_user_id     uuid references auth.users (id) on delete set null,
    matched_at             timestamptz,

    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),

    constraint team_praise_response_key unique (response_id),
    constraint team_praise_response_fk
        foreign key (response_id, org_id)
        references public.customer_responses (id, org_id) on delete cascade,
    constraint team_praise_location_fk
        foreign key (location_id, org_id) references public.locations (id, org_id) on delete cascade,
    -- A record cannot claim to be matched without saying to whom.
    constraint team_praise_matched_has_staff
        check (status <> 'matched' or matched_staff_id is not null)
);

create index team_praise_org_location_time_idx
    on public.team_praise_records (org_id, location_id, created_at desc);
create index team_praise_unmatched_idx
    on public.team_praise_records (org_id, created_at desc)
    where status = 'unmatched';

create trigger team_praise_touch before update on public.team_praise_records
    for each row execute function app.touch_updated_at();

-- --------------------------------------------------- idempotency ----------

create table public.idempotency_records (
    id                      uuid primary key default gen_random_uuid(),
    org_id                  uuid not null references public.organizations (id) on delete cascade,

    operation               text not null check (char_length(operation) between 1 and 40),
    -- The anonymous capability scope: one public stand token digest. Keys
    -- issued for one business therefore cannot collide with another's.
    scope_key               text not null,
    -- Keyed digest of the client's Idempotency-Key. The raw key is not stored.
    idempotency_key         text not null,
    -- Keyed digest of the canonical request body. A retry carrying different
    -- data is a conflict, not a replay.
    request_hash            text not null,

    state                   public.idempotency_state not null default 'in_progress',
    response_status         smallint,
    -- Encrypted: the replayed body carries the session and response capability
    -- tokens that are keyed-hashed everywhere else. Storing them in clear here
    -- would undo that.
    response_body_encrypted text,

    claimed_at              timestamptz not null default now(),
    completed_at            timestamptz,
    created_at              timestamptz not null default now(),
    expires_at              timestamptz not null,

    constraint idempotency_operation_scope_key_unique
        unique (operation, scope_key, idempotency_key),
    constraint idempotency_completed_has_status
        check (state <> 'completed' or response_status is not null)
);

create index idempotency_records_expiry_idx on public.idempotency_records (expires_at);
create index idempotency_records_org_time_idx on public.idempotency_records (org_id, created_at desc);
