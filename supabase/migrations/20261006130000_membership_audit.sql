-- QSurv portal: audit every membership change in the database.
--
-- Invites, role changes and removals used to be audited by the app after the
-- change, as a separate best-effort insert. A project admin can also edit
-- project_memberships straight through the API (RLS allows it), which skipped
-- the audit entirely. A trigger records the change in the same transaction,
-- whichever way it was made.

-- The actor's role in the project before the change (a self-demotion is still
-- recorded as done by a project admin).
create or replace function private.audit_actor_role(p_project_id uuid, p_self_old_role text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then null
    when private.is_super_admin() then 'super_admin'
    when p_self_old_role is not null then p_self_old_role
    else (
      select m.role::text
      from public.project_memberships m
      where m.user_id = (select auth.uid())
        and m.project_id = p_project_id
    )
  end;
$$;

create or replace function private.audit_membership_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_row public.project_memberships := coalesce(new, old);
  v_event text;
  v_payload jsonb;
  v_self_old_role text;
begin
  if tg_op = 'INSERT' then
    v_event := 'membership.added';
    v_payload := jsonb_build_object('role', new.role, 'centre_id', new.centre_id);
  elsif tg_op = 'UPDATE' then
    if new.role = old.role and new.centre_id is not distinct from old.centre_id then
      return new;
    end if;
    v_event := case when new.role <> old.role then 'membership.role_changed' else 'membership.centre_changed' end;
    v_payload := jsonb_build_object(
      'from_role', old.role, 'to_role', new.role,
      'from_centre_id', old.centre_id, 'to_centre_id', new.centre_id
    );
  else
    -- The project (or the user) is being deleted: the audit rows go with it.
    if not exists (select 1 from public.projects p where p.id = old.project_id)
       or not exists (select 1 from public.profiles pr where pr.user_id = old.user_id) then
      return old;
    end if;
    v_event := 'membership.removed';
    v_payload := jsonb_build_object('role', old.role, 'centre_id', old.centre_id);
  end if;

  if tg_op <> 'INSERT' and old.user_id = v_actor then
    v_self_old_role := old.role::text;
  end if;

  insert into public.audit_events (project_id, actor_user_id, actor_role, event_type, entity_type, entity_id, payload)
  values (
    v_row.project_id,
    v_actor,
    private.audit_actor_role(v_row.project_id, v_self_old_role),
    v_event,
    'user',
    v_row.user_id::text,
    v_payload || jsonb_build_object('membership_id', v_row.id)
  );
  return v_row;
end;
$$;

drop trigger if exists trg_project_memberships_audit on public.project_memberships;
create trigger trg_project_memberships_audit
after insert or update of role, centre_id or delete on public.project_memberships
for each row execute function private.audit_membership_change();

revoke all on function
  private.audit_actor_role(uuid, text),
  private.audit_membership_change()
from public, anon, authenticated;

-- ---------- Who may write audit events from the API ----------
-- Before: any project member (centre users too) could insert any event for
-- their project. Now only the project's admins (or a super admin) can, and
-- never an event type the database records itself, so those rows cannot be
-- forged or duplicated. upload.* is not reserved: approve_upload and
-- reject_upload run as the admin and write it under this policy.
create or replace function private.audit_event_reserved(p_event_type text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_event_type like 'membership.%'
      or p_event_type like 'project_request.%'
      or p_event_type like 'project.%'
      or p_event_type like 'kit.%';
$$;

grant execute on function private.audit_event_reserved(text) to authenticated;

drop policy if exists "audit events insert" on public.audit_events;
create policy "audit events insert"
on public.audit_events
for insert
to authenticated
with check (
  actor_user_id = (select auth.uid())
  and not private.audit_event_reserved(event_type)
  and (
    (project_id is null and (select private.is_super_admin()))
    or (project_id is not null and private.can_manage_project(project_id))
  )
);
