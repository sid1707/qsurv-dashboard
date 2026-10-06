-- QSurv portal: audit trail and per-project announcements.

-- ---------- Audit events ----------
create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  -- Null only for global events, such as a super admin reviewing a project request.
  project_id uuid references public.projects(id) on delete cascade,
  actor_user_id uuid references public.profiles(user_id) on delete set null,
  actor_role text,
  event_type text not null,
  entity_type text not null,
  entity_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_events_project on public.audit_events(project_id, created_at desc);
create index if not exists idx_audit_events_actor on public.audit_events(actor_user_id);
create index if not exists idx_audit_events_entity on public.audit_events(entity_type, entity_id);

alter table public.audit_events enable row level security;

drop policy if exists "audit events read" on public.audit_events;
create policy "audit events read"
on public.audit_events
for select
to authenticated
using (
  (select private.is_super_admin())
  or (project_id is not null and private.is_project_admin(project_id))
);

-- Users record events as themselves, only for projects they belong to.
drop policy if exists "audit events insert" on public.audit_events;
create policy "audit events insert"
on public.audit_events
for insert
to authenticated
with check (
  actor_user_id = (select auth.uid())
  and (
    (select private.is_super_admin())
    or (project_id is not null and private.is_project_member(project_id))
  )
);

-- ---------- Announcements ----------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'announcement_audience') then
    create type public.announcement_audience as enum ('all_centres', 'selected_centres');
  end if;
end
$$;

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  body text not null,
  audience public.announcement_audience not null default 'all_centres',
  created_by uuid not null references public.profiles(user_id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  constraint announcements_title_not_blank check (char_length(btrim(title)) > 0),
  constraint announcements_body_not_blank check (char_length(btrim(body)) > 0)
);

comment on column public.announcements.audience is
  'all_centres broadcasts to every centre in the project; selected_centres uses announcement_centres.';

create table if not exists public.announcement_centres (
  announcement_id uuid not null,
  project_id uuid not null,
  centre_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (announcement_id, centre_id),
  foreign key (announcement_id, project_id)
    references public.announcements(id, project_id) on delete cascade,
  foreign key (centre_id, project_id)
    references public.centres(id, project_id) on delete cascade
);

create table if not exists public.announcement_dismissals (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

create index if not exists idx_announcements_project
  on public.announcements(project_id, created_at desc);
create index if not exists idx_announcements_created_by on public.announcements(created_by);
create index if not exists idx_announcement_centres_announcement
  on public.announcement_centres(announcement_id, project_id);
create index if not exists idx_announcement_centres_centre
  on public.announcement_centres(centre_id, project_id);
create index if not exists idx_announcement_dismissals_user
  on public.announcement_dismissals(user_id);

drop trigger if exists trg_announcements_updated_at on public.announcements;
create trigger trg_announcements_updated_at before update on public.announcements
for each row execute function public.set_updated_at();

-- Project admins see all their project's announcements. Centre users see
-- unarchived ones addressed to every centre or to their own centre.
create or replace function private.can_read_announcement(p_announcement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.announcements a
    where a.id = p_announcement_id
      and (
        private.can_manage_project(a.project_id)
        or (
          a.archived_at is null
          and exists (
            select 1
            from public.project_memberships m
            where m.user_id = (select auth.uid())
              and m.project_id = a.project_id
              and m.role = 'centre_user'
              and (
                a.audience = 'all_centres'
                or exists (
                  select 1
                  from public.announcement_centres ac
                  where ac.announcement_id = a.id
                    and ac.centre_id = m.centre_id
                )
              )
          )
        )
      )
  );
$$;

revoke all on function private.can_read_announcement(uuid) from public, anon;
grant execute on function private.can_read_announcement(uuid) to authenticated;

alter table public.announcements enable row level security;
alter table public.announcement_centres enable row level security;
alter table public.announcement_dismissals enable row level security;

drop policy if exists "announcements read" on public.announcements;
create policy "announcements read"
on public.announcements
for select
to authenticated
using (private.can_read_announcement(id));

drop policy if exists "announcements insert" on public.announcements;
create policy "announcements insert"
on public.announcements
for insert
to authenticated
with check (private.can_manage_project(project_id) and created_by = (select auth.uid()));

drop policy if exists "announcements update" on public.announcements;
create policy "announcements update"
on public.announcements
for update
to authenticated
using (private.can_manage_project(project_id))
with check (private.can_manage_project(project_id));

drop policy if exists "announcements delete" on public.announcements;
create policy "announcements delete"
on public.announcements
for delete
to authenticated
using (private.can_manage_project(project_id));

-- Centre users only learn whether their own centre was targeted.
drop policy if exists "announcement centres read" on public.announcement_centres;
create policy "announcement centres read"
on public.announcement_centres
for select
to authenticated
using (private.can_access_centre(project_id, centre_id));

drop policy if exists "announcement centres manage" on public.announcement_centres;
create policy "announcement centres manage"
on public.announcement_centres
for all
to authenticated
using (private.can_manage_project(project_id))
with check (private.can_manage_project(project_id));

drop policy if exists "announcement dismissals read own" on public.announcement_dismissals;
create policy "announcement dismissals read own"
on public.announcement_dismissals
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "announcement dismissals insert own" on public.announcement_dismissals;
create policy "announcement dismissals insert own"
on public.announcement_dismissals
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and private.can_read_announcement(announcement_id)
);

drop policy if exists "announcement dismissals delete own" on public.announcement_dismissals;
create policy "announcement dismissals delete own"
on public.announcement_dismissals
for delete
to authenticated
using (user_id = (select auth.uid()));

-- ---------- Grants ----------
revoke all on
  public.audit_events,
  public.announcements,
  public.announcement_centres,
  public.announcement_dismissals
from anon, authenticated;

grant select, insert on public.audit_events to authenticated;
grant select, insert, update, delete on public.announcements to authenticated;
grant select, insert, delete on public.announcement_centres to authenticated;
grant select, insert, delete on public.announcement_dismissals to authenticated;

grant all on
  public.audit_events,
  public.announcements,
  public.announcement_centres,
  public.announcement_dismissals
to service_role;
