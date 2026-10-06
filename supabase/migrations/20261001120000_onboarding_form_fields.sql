-- Onboarding form: fields from the five-step form, a public request reference,
-- unique short codes, fixed option lists, and a rate-limit store for public forms.

-- ---------- project_requests ----------
alter table public.project_requests
  add column if not exists reference text,
  add column if not exists requested_code text,
  add column if not exists funding_agency text,
  add column if not exists ethics_reference text,
  add column if not exists sample_type_other text,
  add column if not exists instrument_other text,
  add column if not exists consent_accepted_at timestamptz;

-- Short, non-sequential reference shown to the requester, e.g. QS-1A2B3C4D.
alter table public.project_requests
  alter column reference set default ('QS-' || upper(substr(md5(gen_random_uuid()::text), 1, 8)));
update public.project_requests
  set reference = ('QS-' || upper(substr(md5(gen_random_uuid()::text), 1, 8)))
  where reference is null;
alter table public.project_requests alter column reference set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_requests_reference_key') then
    alter table public.project_requests add constraint project_requests_reference_key unique (reference);
  end if;
end
$$;

comment on column public.project_requests.requested_code is
  'Short code the nodal lab wants for the project. Becomes projects.code on approval.';
comment on column public.project_requests.consent_accepted_at is
  'When the requester accepted the terms and data-sharing consent.';

alter table public.project_requests
  drop constraint if exists project_requests_requested_code_format,
  add constraint project_requests_requested_code_format
    check (requested_code is null or requested_code ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'),
  drop constraint if exists project_requests_sample_type_option,
  add constraint project_requests_sample_type_option
    check (sample_type in ('wastewater', 'clinical', 'environmental', 'other')),
  drop constraint if exists project_requests_frequency_option,
  add constraint project_requests_frequency_option
    check (frequency in ('weekly', 'fortnightly', 'monthly')),
  drop constraint if exists project_requests_instrument_option,
  add constraint project_requests_instrument_option
    check (instrument is null or instrument in ('quantstudio_5', 'biorad_cfx96', 'other')),
  drop constraint if exists project_requests_user_tier_option,
  add constraint project_requests_user_tier_option
    check (user_tier is null or user_tier in ('under_20', '20_to_50', '50_to_100', 'over_100'));

-- A code stays reserved while its request is pending or approved.
create unique index if not exists idx_project_requests_requested_code_active
  on public.project_requests(requested_code)
  where status <> 'rejected';

-- ---------- projects: same fields and options, copied on approval ----------
alter table public.projects
  add column if not exists funding_agency text,
  add column if not exists ethics_reference text,
  add column if not exists sample_type_other text,
  add column if not exists instrument_other text;

alter table public.projects
  drop constraint if exists projects_sample_type_option,
  add constraint projects_sample_type_option
    check (sample_type in ('wastewater', 'clinical', 'environmental', 'other')),
  drop constraint if exists projects_frequency_option,
  add constraint projects_frequency_option
    check (frequency in ('weekly', 'fortnightly', 'monthly')),
  drop constraint if exists projects_instrument_option,
  add constraint projects_instrument_option
    check (instrument is null or instrument in ('quantstudio_5', 'biorad_cfx96', 'other')),
  drop constraint if exists projects_user_tier_option,
  add constraint projects_user_tier_option
    check (user_tier is null or user_tier in ('under_20', '20_to_50', '50_to_100', 'over_100'));

-- ---------- Rate limiting for public endpoints ----------
-- Keys are hashed by the server (never raw IP addresses). Service role only.
create table if not exists public.rate_limit_hits (
  id bigint generated always as identity primary key,
  bucket text not null,
  key_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_rate_limit_hits_lookup
  on public.rate_limit_hits(bucket, key_hash, created_at);

alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from anon, authenticated;
grant all on public.rate_limit_hits to service_role;

-- Records a hit and returns true if it is within the limit, false if over it.
create or replace function public.consume_rate_limit(
  p_bucket text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Serialise hits for the same key so concurrent requests cannot exceed the limit.
  perform pg_advisory_xact_lock(hashtextextended(p_bucket || ':' || p_key_hash, 0));

  delete from public.rate_limit_hits
  where bucket = p_bucket
    and key_hash = p_key_hash
    and created_at < now() - make_interval(secs => p_window_seconds);

  select count(*) into v_count
  from public.rate_limit_hits
  where bucket = p_bucket
    and key_hash = p_key_hash;

  if v_count >= p_limit then
    return false;
  end if;

  insert into public.rate_limit_hits (bucket, key_hash) values (p_bucket, p_key_hash);
  return true;
end;
$$;

revoke all on function public.consume_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, text, integer, integer) to service_role;
