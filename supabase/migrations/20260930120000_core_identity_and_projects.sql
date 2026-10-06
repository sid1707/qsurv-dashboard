-- QSurv portal: identity, kits, project requests, projects, centres, memberships.
-- Roles live on project_memberships, never on the user. The only global flag is
-- profiles.is_super_admin.

-- ---------- Types ----------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'request_status') then
    create type public.request_status as enum ('pending', 'approved', 'rejected');
  end if;

  if not exists (select 1 from pg_type where typname = 'project_status') then
    create type public.project_status as enum ('active', 'suspended', 'archived');
  end if;

  if not exists (select 1 from pg_type where typname = 'membership_role') then
    create type public.membership_role as enum ('project_admin', 'centre_user');
  end if;

  if not exists (select 1 from pg_type where typname = 'kit_control_type') then
    create type public.kit_control_type as enum (
      'none',
      'internal_control',
      'positive_control',
      'negative_control',
      'ntc'
    );
  end if;
end
$$;

-- Helpers used by RLS live here so PostgREST does not expose them as RPCs.
create schema if not exists private;

-- ---------- Utility functions ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- Profiles ----------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  is_super_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.profiles.is_super_admin is
  'Global QSurv administrator. Only changeable with the service role.';

-- Every new auth user gets a profile. Name and phone come from sign-up metadata.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_auth_users_create_profile on auth.users;
create trigger trg_auth_users_create_profile
after insert on auth.users
for each row execute function private.handle_new_user();

-- ---------- Kits and panels ----------
create table if not exists public.kits (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version text not null default '1.0',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, version),
  constraint kits_name_not_blank check (char_length(btrim(name)) > 0)
);

create table if not exists public.kit_targets (
  id uuid primary key default gen_random_uuid(),
  kit_id uuid not null references public.kits(id) on delete cascade,
  target_name text not null,
  aliases text[] not null default '{}',
  fluorophore text not null,
  channel text,
  plate_wells text[] not null default '{}',
  control_type public.kit_control_type not null default 'none',
  ct_min numeric,
  ct_max numeric,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kit_id, target_name),
  constraint kit_targets_ct_range check (ct_min is null or ct_max is null or ct_min <= ct_max)
);

comment on column public.kit_targets.aliases is
  'Alternative target names that may appear in instrument run files.';
comment on column public.kit_targets.plate_wells is
  'Wells in the fixed plate layout where this target is read, e.g. {A1,B1}.';
comment on column public.kit_targets.channel is
  'Instrument detection channel for the fluorophore.';
comment on column public.kit_targets.ct_min is
  'Lowest acceptable Ct. Values below are flagged during validation.';
comment on column public.kit_targets.ct_max is
  'Highest acceptable Ct (cut-off). Values above are treated as not detected.';

create index if not exists idx_kit_targets_kit on public.kit_targets(kit_id, sort_order);

-- ---------- Project requests (public onboarding form) ----------
create table if not exists public.project_requests (
  id uuid primary key default gen_random_uuid(),
  -- Account created at submission. The password goes only to Supabase Auth.
  requester_user_id uuid references auth.users(id) on delete set null,
  requester_name text not null,
  requester_email text not null,
  requester_phone text,
  requester_designation text,
  institution_name text not null,
  department text,
  city text,
  state text,
  project_title text not null,
  objective text not null,
  start_date date,
  end_date date,
  sample_type text not null,
  frequency text not null,
  kit_id uuid references public.kits(id),
  instrument text,
  user_tier text,
  data_management boolean not null default true,
  data_compilation boolean not null default false,
  data_plotting boolean not null default false,
  expected_centre_count integer,
  proposed_centres jsonb not null default '[]'::jsonb,
  additional_notes text,
  status public.request_status not null default 'pending',
  reviewed_by uuid references public.profiles(user_id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_requests_dates check (end_date is null or start_date is null or end_date >= start_date),
  constraint project_requests_centre_count check (expected_centre_count is null or expected_centre_count > 0),
  constraint project_requests_proposed_centres_array check (jsonb_typeof(proposed_centres) = 'array'),
  constraint project_requests_review_consistency check (
    (status = 'pending' and reviewed_at is null)
    or (status <> 'pending' and reviewed_at is not null)
  )
);

comment on table public.project_requests is
  'Onboarding requests from nodal labs. Inserted by server code with the service role.';
comment on column public.project_requests.proposed_centres is
  'Array of {name, city, state, contact_email} objects entered on the form.';

create index if not exists idx_project_requests_status on public.project_requests(status, created_at desc);
create index if not exists idx_project_requests_requester on public.project_requests(requester_user_id);
create index if not exists idx_project_requests_kit on public.project_requests(kit_id);
create index if not exists idx_project_requests_reviewed_by on public.project_requests(reviewed_by);

-- ---------- Projects ----------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  objective text,
  start_date date,
  end_date date,
  sample_type text not null,
  frequency text not null,
  kit_id uuid not null references public.kits(id),
  instrument text,
  user_tier text,
  data_management boolean not null default true,
  data_compilation boolean not null default false,
  data_plotting boolean not null default false,
  status public.project_status not null default 'active',
  request_id uuid unique references public.project_requests(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The code is the first segment of storage paths, so keep it path-safe.
  constraint projects_code_format check (code ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'),
  constraint projects_dates check (end_date is null or start_date is null or end_date >= start_date)
);

create index if not exists idx_projects_kit on public.projects(kit_id);

-- ---------- Centres ----------
create table if not exists public.centres (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  city text,
  state text,
  contact_email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name),
  -- Lets child tables use (centre_id, project_id) foreign keys so a row can never
  -- claim a centre from a different project.
  unique (id, project_id)
);

create index if not exists idx_centres_project on public.centres(project_id);

-- ---------- Project memberships ----------
create table if not exists public.project_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  centre_id uuid,
  role public.membership_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, project_id),
  foreign key (centre_id, project_id) references public.centres(id, project_id) on delete cascade,
  constraint project_memberships_role_centre check (
    (role = 'project_admin' and centre_id is null)
    or (role = 'centre_user' and centre_id is not null)
  )
);

create index if not exists idx_project_memberships_project on public.project_memberships(project_id, role);
create index if not exists idx_project_memberships_centre on public.project_memberships(centre_id, project_id);

-- ---------- updated_at triggers ----------
drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_kits_updated_at on public.kits;
create trigger trg_kits_updated_at before update on public.kits
for each row execute function public.set_updated_at();

drop trigger if exists trg_kit_targets_updated_at on public.kit_targets;
create trigger trg_kit_targets_updated_at before update on public.kit_targets
for each row execute function public.set_updated_at();

drop trigger if exists trg_project_requests_updated_at on public.project_requests;
create trigger trg_project_requests_updated_at before update on public.project_requests
for each row execute function public.set_updated_at();

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at before update on public.projects
for each row execute function public.set_updated_at();

drop trigger if exists trg_centres_updated_at on public.centres;
create trigger trg_centres_updated_at before update on public.centres
for each row execute function public.set_updated_at();

drop trigger if exists trg_project_memberships_updated_at on public.project_memberships;
create trigger trg_project_memberships_updated_at before update on public.project_memberships
for each row execute function public.set_updated_at();

-- ---------- Authorization helpers ----------
-- security definer so they can read memberships without recursing into RLS.
-- Every helper checks the calling user via auth.uid().

create or replace function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_super_admin from public.profiles p where p.user_id = (select auth.uid())),
    false
  );
$$;

create or replace function private.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_memberships m
    where m.user_id = (select auth.uid())
      and m.project_id = p_project_id
  );
$$;

create or replace function private.is_project_admin(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_memberships m
    where m.user_id = (select auth.uid())
      and m.project_id = p_project_id
      and m.role = 'project_admin'
  );
$$;

create or replace function private.is_centre_member(p_project_id uuid, p_centre_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_memberships m
    where m.user_id = (select auth.uid())
      and m.project_id = p_project_id
      and m.centre_id = p_centre_id
      and m.role = 'centre_user'
  );
$$;

-- Super admin, or the project's admin.
create or replace function private.can_manage_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin() or private.is_project_admin(p_project_id);
$$;

-- Super admin, the project's admin, or a centre user of that centre.
create or replace function private.can_access_centre(p_project_id uuid, p_centre_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_manage_project(p_project_id)
      or private.is_centre_member(p_project_id, p_centre_id);
$$;

-- True when the caller administers a project that p_user_id belongs to.
create or replace function private.administers_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_memberships mine
    join public.project_memberships theirs on theirs.project_id = mine.project_id
    where mine.user_id = (select auth.uid())
      and mine.role = 'project_admin'
      and theirs.user_id = p_user_id
  );
$$;

revoke all on function
  private.handle_new_user(),
  private.is_super_admin(),
  private.is_project_member(uuid),
  private.is_project_admin(uuid),
  private.is_centre_member(uuid, uuid),
  private.can_manage_project(uuid),
  private.can_access_centre(uuid, uuid),
  private.administers_user(uuid)
from public, anon;

-- Policies run as the calling role, so authenticated needs to execute these.
grant usage on schema private to authenticated;
grant execute on function
  private.is_super_admin(),
  private.is_project_member(uuid),
  private.is_project_admin(uuid),
  private.is_centre_member(uuid, uuid),
  private.can_manage_project(uuid),
  private.can_access_centre(uuid, uuid),
  private.administers_user(uuid)
to authenticated;

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.kits enable row level security;
alter table public.kit_targets enable row level security;
alter table public.project_requests enable row level security;
alter table public.projects enable row level security;
alter table public.centres enable row level security;
alter table public.project_memberships enable row level security;

-- profiles
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read"
on public.profiles
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select private.is_super_admin())
  or private.administers_user(user_id)
);

drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update"
on public.profiles
for update
to authenticated
using (user_id = (select auth.uid()) or (select private.is_super_admin()))
with check (user_id = (select auth.uid()) or (select private.is_super_admin()));

-- kits: the public onboarding form lists active kits.
drop policy if exists "kits public read active" on public.kits;
create policy "kits public read active"
on public.kits
for select
to anon
using (active);

drop policy if exists "kits read" on public.kits;
create policy "kits read"
on public.kits
for select
to authenticated
using (active or (select private.is_super_admin()));

drop policy if exists "kits super admin write" on public.kits;
create policy "kits super admin write"
on public.kits
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

-- kit targets
drop policy if exists "kit targets public read active" on public.kit_targets;
create policy "kit targets public read active"
on public.kit_targets
for select
to anon
using (exists (select 1 from public.kits k where k.id = kit_id and k.active));

drop policy if exists "kit targets read" on public.kit_targets;
create policy "kit targets read"
on public.kit_targets
for select
to authenticated
using (
  (select private.is_super_admin())
  or exists (select 1 from public.kits k where k.id = kit_id and k.active)
);

drop policy if exists "kit targets super admin write" on public.kit_targets;
create policy "kit targets super admin write"
on public.kit_targets
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

-- project requests: requesters see their own; only super admin reviews.
drop policy if exists "project requests read" on public.project_requests;
create policy "project requests read"
on public.project_requests
for select
to authenticated
using (
  requester_user_id = (select auth.uid())
  or (select private.is_super_admin())
);

drop policy if exists "project requests super admin update" on public.project_requests;
create policy "project requests super admin update"
on public.project_requests
for update
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

-- projects
drop policy if exists "projects read" on public.projects;
create policy "projects read"
on public.projects
for select
to authenticated
using ((select private.is_super_admin()) or private.is_project_member(id));

drop policy if exists "projects super admin write" on public.projects;
create policy "projects super admin write"
on public.projects
for all
to authenticated
using ((select private.is_super_admin()))
with check ((select private.is_super_admin()));

-- centres: centre users see only their own centre.
drop policy if exists "centres read" on public.centres;
create policy "centres read"
on public.centres
for select
to authenticated
using (private.can_access_centre(project_id, id));

drop policy if exists "centres manage" on public.centres;
create policy "centres manage"
on public.centres
for all
to authenticated
using (private.can_manage_project(project_id))
with check (private.can_manage_project(project_id));

-- project memberships
drop policy if exists "memberships read" on public.project_memberships;
create policy "memberships read"
on public.project_memberships
for select
to authenticated
using (
  user_id = (select auth.uid())
  or private.can_manage_project(project_id)
);

drop policy if exists "memberships manage" on public.project_memberships;
create policy "memberships manage"
on public.project_memberships
for all
to authenticated
using (private.can_manage_project(project_id))
with check (private.can_manage_project(project_id));

-- ---------- Grants ----------
revoke all on
  public.profiles,
  public.kits,
  public.kit_targets,
  public.project_requests,
  public.projects,
  public.centres,
  public.project_memberships
from anon, authenticated;

grant select on public.kits, public.kit_targets to anon;

grant select on public.profiles to authenticated;
-- Users may edit their own name and phone. is_super_admin is service-role only.
grant update (full_name, phone) on public.profiles to authenticated;

grant select, insert, update, delete
  on public.kits,
     public.kit_targets,
     public.projects,
     public.centres,
     public.project_memberships
to authenticated;

grant select, update on public.project_requests to authenticated;

grant all on
  public.profiles,
  public.kits,
  public.kit_targets,
  public.project_requests,
  public.projects,
  public.centres,
  public.project_memberships
to service_role;
