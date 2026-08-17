-- Reject ports in Google review URL validator.
--
-- The previous version stripped the port from the authority and matched
-- only the hostname, allowing e.g. g.page:8443 to pass.  Standard Google
-- services never use non-standard ports, so any port is suspicious.

create or replace function public._validate_google_review_url(p_url text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
    v_after_scheme text;
    v_authority    text;
    v_host         text;
    v_path         text;
    v_slash_pos    integer;
    v_at_pos       integer;
    v_colon_pos    integer;
begin
    if p_url is null or char_length(p_url) = 0 or char_length(p_url) > 2048 then
        return false;
    end if;

    if not (p_url ~ '^https://') then
        return false;
    end if;

    v_after_scheme := substring(p_url from 9);

    if char_length(v_after_scheme) = 0 then
        return false;
    end if;

    v_slash_pos := position('/' in v_after_scheme);
    if v_slash_pos = 0 then
        v_authority := v_after_scheme;
        v_path := '/';
    else
        v_authority := substring(v_after_scheme from 1 for v_slash_pos - 1);
        v_path := substring(v_after_scheme from v_slash_pos);
    end if;

    if char_length(v_authority) = 0 then
        return false;
    end if;

    v_at_pos := position('@' in v_authority);
    if v_at_pos > 0 then
        return false;
    end if;

    v_colon_pos := position(':' in v_authority);
    if v_colon_pos > 0 then
        return false;
    end if;

    v_host := lower(v_authority);
    v_host := rtrim(v_host, '.');

    if char_length(v_host) = 0 then
        return false;
    end if;

    if v_host in ('g.page', 'maps.app.goo.gl') then
        return true;
    end if;

    if v_host = 'search.google.com' then
        return v_path ~ '^/local/writereview\?'
           and v_path ~ '[?&]placeid=[^&]+';
    end if;

    if v_host in ('www.google.com', 'maps.google.com') then
        return v_path ~ '^/maps/';
    end if;

    return false;
end;
$$;
