-- Project admin dashboard (/p/[code]/admin):
--   * The user tier chosen at onboarding caps how many people a project can have.
--   * A project always keeps at least one project admin.
--   * Project admins can list their users with emails, see per-centre activity,
--     edit project details, change the kit until data exists, and publish
--     announcements to all or selected centres in one transaction.
-- Functions that bypass RLS check the caller with auth.uid() themselves.

-- ---------- User tier limits ----------
-- Upper bound of each tier on the onboarding form. Keep in step with
-- USER_TIER_LIMITS in lib/project-admin/user-limits.ts. Null means no limit.
create or replace function private.user_tier_limit(p_tier text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_tier
    when 'under_20' then 20
    when '20_to_50' then 50
    when '50_to_100' then 100
    else null
  end;
$$;

create or replace function private.enforce_project_user_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tier text;
  v_limit integer;
  v_count integer;
begin
  -- Lock the project so two invites at once cannot both take the last place.
  select p.user_tier into v_tier from public.projects p where p.id = new.project_id for update;
  v_limit := private.user_tier_limit(v_tier);
  if v_limit is null then
    return new;
  end if;

  select count(*) into v_count from public.project_memberships m where m.project_id = new.project_id;
  if v_count >= v_limit then
    raise exception 'This project has reached its limit of % users. Remove a user first, or ask the QSurv team to raise the limit.', v_limit
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_project_memberships_user_limit on public.project_memberships;
create trigger trg_project_memberships_user_limit
before insert on public.project_memberships
for each row execute function private.enforce_project_user_limit();

-- ---------- Keep at least one project admin ----------
create or replace function private.keep_one_project_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role <> 'project_admin' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.role = 'project_admin' and new.project_id = old.project_id then
    return new;
  end if;

  -- When the project itself is being deleted the row is already gone, so the
  -- cascade goes through. The lock serialises two admins removing each other.
  perform 1 from public.projects p where p.id = old.project_id for update;
  if not found then
    return coalesce(new, old);
  end if;

  if not exists (
    select 1
    from public.project_memberships m
    where m.project_id = old.project_id
      and m.role = 'project_admin'
      and m.id <> old.id
  ) then
    raise exception 'A project needs at least one project admin. Make someone else an admin first.'
      using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_project_memberships_keep_admin on public.project_memberships;
create trigger trg_project_memberships_keep_admin
before update of role, project_id or delete on public.project_memberships
for each row execute function private.keep_one_project_admin();

revoke all on function
  private.user_tier_limit(text),
  private.enforce_project_user_limit(),
  private.keep_one_project_admin()
from public, anon, authenticated;

-- ---------- Member directory ----------
-- Emails live in auth.users, which the API cannot read, so admins get them here.
create or replace function public.project_member_directory(p_project_id uuid)
returns table (
  membership_id uuid,
  user_id uuid,
  full_name text,
  email text,
  role public.membership_role,
  centre_id uuid,
  centre_name text,
  added_at timestamptz,
  invited_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if (select auth.uid()) is null or not private.can_manage_project(p_project_id) then
    raise exception 'Only a project admin can list project users.' using errcode = '42501';
  end if;

  return query
  select m.id, m.user_id, p.full_name, u.email::text, m.role, m.centre_id, c.name,
         m.created_at, u.invited_at, u.last_sign_in_at
  from public.project_memberships m
  join public.profiles p on p.user_id = m.user_id
  join auth.users u on u.id = m.user_id
  left join public.centres c on c.id = m.centre_id
  where m.project_id = p_project_id
  order by m.role, lower(nullif(p.full_name, '')) nulls last, lower(u.email);
end;
$$;

-- Server-side invite flow only: finds an existing account so it is added
-- instead of invited again.
create or replace function public.auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1;
$$;

-- ---------- Per-centre activity for the overview ----------
-- Runs as the caller, so RLS limits it to projects they can see. Draft batches
-- are not uploads yet. "Pending approval" is a submitted, active batch that is
-- neither approved nor rejected.
create or replace function public.project_centre_activity(p_project_id uuid)
returns table (
  centre_id uuid,
  centre_name text,
  active boolean,
  users integer,
  uploads_this_month integer,
  pending_approvals integer,
  last_upload_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with month_start as (
    -- Months follow India time, like every date shown in the portal.
    select (date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') as t
  ),
  batches as (
    select b.centre_id,
           coalesce(b.submitted_at, b.created_at) as uploaded_at,
           (b.is_active and b.approval_status = 'pending'
              and b.upload_status not in ('draft', 'rejected', 'approved')) as pending
    from public.upload_batches b
    where b.project_id = p_project_id
      and b.upload_status <> 'draft'
  )
  select c.id,
         c.name,
         c.active,
         (select count(*)::int from public.project_memberships m
           where m.project_id = c.project_id and m.centre_id = c.id),
         (select count(*)::int from batches b, month_start ms
           where b.centre_id = c.id and b.uploaded_at >= ms.t),
         (select count(*)::int from batches b where b.centre_id = c.id and b.pending),
         (select max(b.uploaded_at) from batches b where b.centre_id = c.id)
  from public.centres c
  where c.project_id = p_project_id
  order by c.active desc, lower(c.name);
$$;

-- ---------- Project settings ----------
-- p_details: {title, objective, funding_agency, ethics_reference, start_date, end_date, frequency}
create or replace function public.update_project_details(p_project_id uuid, p_details jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_title text := btrim(coalesce(p_details ->> 'title', ''));
begin
  if v_actor is null or not private.can_manage_project(p_project_id) then
    raise exception 'Only a project admin can edit project settings.' using errcode = '42501';
  end if;
  if v_title = '' or char_length(v_title) > 200 then
    raise exception 'The project title must be 1 to 200 characters.' using errcode = '22023';
  end if;

  update public.projects
  set title = v_title,
      objective = nullif(btrim(p_details ->> 'objective'), ''),
      funding_agency = nullif(btrim(p_details ->> 'funding_agency'), ''),
      ethics_reference = nullif(btrim(p_details ->> 'ethics_reference'), ''),
      start_date = nullif(p_details ->> 'start_date', '')::date,
      end_date = nullif(p_details ->> 'end_date', '')::date,
      frequency = p_details ->> 'frequency'
  where id = p_project_id;
  if not found then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;

  insert into public.audit_events (project_id, actor_user_id, actor_role, event_type, entity_type, entity_id, payload)
  values (p_project_id, v_actor, 'project_admin', 'project.details_updated', 'project', p_project_id::text, p_details);
end;
$$;

-- The kit, plate layout and rules go together: a layout names the kit's tubes.
-- Once any upload exists the kit is fixed, so stored results keep their meaning.
create or replace function public.change_project_kit(
  p_project_id uuid,
  p_kit_id uuid,
  p_plate_layout jsonb,
  p_qc_rules jsonb,
  p_compile_rules jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_old_kit uuid;
begin
  if v_actor is null or not private.can_manage_project(p_project_id) then
    raise exception 'Only a project admin can change the kit.' using errcode = '42501';
  end if;

  select p.kit_id into v_old_kit from public.projects p where p.id = p_project_id for update;
  if not found then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.upload_batches b where b.project_id = p_project_id) then
    raise exception 'The kit cannot be changed once centres have uploaded data.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.kits k where k.id = p_kit_id and k.active) then
    raise exception 'Choose an available kit.' using errcode = '22023';
  end if;

  update public.projects
  set kit_id = p_kit_id,
      plate_layout = p_plate_layout,
      qc_rules = p_qc_rules,
      compile_rules = p_compile_rules
  where id = p_project_id;

  insert into public.audit_events (project_id, actor_user_id, actor_role, event_type, entity_type, entity_id, payload)
  values (
    p_project_id, v_actor, 'project_admin', 'project.kit_changed', 'project', p_project_id::text,
    jsonb_build_object('from_kit_id', v_old_kit, 'to_kit_id', p_kit_id)
  );
end;
$$;

-- ---------- Announcements ----------
-- Runs as the caller: the announcement RLS policies decide who may publish.
create or replace function public.create_announcement(
  p_project_id uuid,
  p_title text,
  p_body text,
  p_audience public.announcement_audience,
  p_centre_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ids uuid[] := array(select distinct x from unnest(coalesce(p_centre_ids, '{}')) as x);
  -- No RETURNING: the read policy looks the row up in a function, which cannot
  -- see a row inserted by the same statement.
  v_id uuid := gen_random_uuid();
begin
  if p_audience = 'selected_centres' then
    if cardinality(v_ids) = 0 then
      raise exception 'Select at least one centre.' using errcode = '22023';
    end if;
    if (
      select count(*) from public.centres c
      where c.project_id = p_project_id and c.active and c.id = any (v_ids)
    ) <> cardinality(v_ids) then
      raise exception 'One or more selected centres are not active in this project.' using errcode = '22023';
    end if;
  elsif cardinality(v_ids) > 0 then
    raise exception 'Do not select individual centres when sending to all centres.' using errcode = '22023';
  end if;

  insert into public.announcements (id, project_id, title, body, audience, created_by)
  values (v_id, p_project_id, btrim(p_title), btrim(p_body), p_audience, (select auth.uid()));

  insert into public.announcement_centres (announcement_id, project_id, centre_id)
  select v_id, p_project_id, x from unnest(v_ids) as x;

  return v_id;
end;
$$;

-- ---------- Project members read their project's kit ----------
-- The existing policies only show active kits. A project keeps its kit after the
-- kit is retired from the onboarding form, and its members still need the panel.
drop policy if exists "kits read project kit" on public.kits;
create policy "kits read project kit"
on public.kits
for select
to authenticated
using (
  exists (
    select 1 from public.projects p
    where p.kit_id = kits.id and private.is_project_member(p.id)
  )
);

drop policy if exists "kit targets read project kit" on public.kit_targets;
create policy "kit targets read project kit"
on public.kit_targets
for select
to authenticated
using (
  exists (
    select 1 from public.projects p
    where p.kit_id = kit_targets.kit_id and private.is_project_member(p.id)
  )
);

-- ---------- Grants ----------
revoke all on function
  public.project_member_directory(uuid),
  public.auth_user_id_by_email(text),
  public.project_centre_activity(uuid),
  public.update_project_details(uuid, jsonb),
  public.change_project_kit(uuid, uuid, jsonb, jsonb, jsonb),
  public.create_announcement(uuid, text, text, public.announcement_audience, uuid[])
from public, anon;

revoke all on function public.auth_user_id_by_email(text) from authenticated;
grant execute on function public.auth_user_id_by_email(text) to service_role;

grant execute on function
  public.project_member_directory(uuid),
  public.project_centre_activity(uuid),
  public.update_project_details(uuid, jsonb),
  public.change_project_kit(uuid, uuid, jsonb, jsonb, jsonb),
  public.create_announcement(uuid, text, text, public.announcement_audience, uuid[])
to authenticated;
