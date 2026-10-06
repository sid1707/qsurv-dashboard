-- Super admin: approve or reject project requests, and save kits with their
-- targets. Each function runs as a single transaction and checks the caller is a
-- super admin, so the database enforces this even if the app check is bypassed.

-- ---------- Approve ----------
create or replace function public.approve_project_request(p_request_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  r public.project_requests%rowtype;
  v_project_id uuid;
  v_centres integer;
begin
  if v_actor is null or not private.is_super_admin() then
    raise exception 'Only a super admin can approve project requests.' using errcode = '42501';
  end if;

  select * into r from public.project_requests where id = p_request_id for update;
  if not found then
    raise exception 'Project request not found.' using errcode = 'P0002';
  end if;
  if r.status <> 'pending' then
    raise exception 'This request has already been %.', r.status using errcode = 'P0001';
  end if;
  if r.requester_user_id is null then
    raise exception 'This request has no admin account to activate.' using errcode = 'P0001';
  end if;
  if r.requested_code is null then
    raise exception 'This request has no short code.' using errcode = 'P0001';
  end if;
  if r.kit_id is null then
    raise exception 'This request has no kit selected.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.projects p where p.code = r.requested_code) then
    raise exception 'The short code % is already used by another project.', r.requested_code
      using errcode = '23505';
  end if;

  insert into public.projects (
    code, title, objective, start_date, end_date, sample_type, sample_type_other, frequency,
    kit_id, instrument, instrument_other, user_tier, funding_agency, ethics_reference,
    data_management, data_compilation, data_plotting, status, request_id
  )
  values (
    r.requested_code, r.project_title, r.objective, r.start_date, r.end_date, r.sample_type,
    r.sample_type_other, r.frequency, r.kit_id, r.instrument, r.instrument_other, r.user_tier,
    r.funding_agency, r.ethics_reference, r.data_management, r.data_compilation, r.data_plotting,
    'active', r.id
  )
  returning id into v_project_id;

  -- Centres listed on the form. Blank names are skipped and duplicate names merged.
  insert into public.centres (project_id, name, city, contact_email)
  select distinct on (lower(btrim(c ->> 'name')))
    v_project_id,
    btrim(c ->> 'name'),
    nullif(btrim(c ->> 'city'), ''),
    nullif(lower(btrim(c ->> 'contact_email')), '')
  from jsonb_array_elements(r.proposed_centres) as c
  where nullif(btrim(c ->> 'name'), '') is not null
  order by lower(btrim(c ->> 'name'));
  get diagnostics v_centres = row_count;

  insert into public.project_memberships (user_id, project_id, centre_id, role)
  values (r.requester_user_id, v_project_id, null, 'project_admin');

  update public.project_requests
  set status = 'approved',
      reviewed_by = v_actor,
      reviewed_at = now(),
      review_note = nullif(btrim(p_note), '')
  where id = p_request_id;

  -- Unblock the admin's login (onboarding created the account banned).
  update auth.users
  set banned_until = null,
      raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('qsurv_status', 'approved')
  where id = r.requester_user_id;

  insert into public.audit_events (project_id, actor_user_id, actor_role, event_type, entity_type, entity_id, payload)
  values (
    v_project_id, v_actor, 'super_admin', 'project_request.approved', 'project_request', p_request_id::text,
    jsonb_build_object(
      'reference', r.reference,
      'project_code', r.requested_code,
      'centres_created', v_centres,
      'admin_user_id', r.requester_user_id
    )
  );

  return jsonb_build_object(
    'project_id', v_project_id,
    'project_code', r.requested_code,
    'reference', r.reference,
    'centres_created', v_centres
  );
end;
$$;

-- ---------- Reject ----------
-- The admin account stays banned; nothing in auth.users changes.
create or replace function public.reject_project_request(p_request_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  r public.project_requests%rowtype;
begin
  if v_actor is null or not private.is_super_admin() then
    raise exception 'Only a super admin can reject project requests.' using errcode = '42501';
  end if;
  if v_reason = '' then
    raise exception 'A reason is required to reject a request.' using errcode = '22023';
  end if;
  if char_length(v_reason) > 2000 then
    raise exception 'The reason must be 2000 characters or fewer.' using errcode = '22023';
  end if;

  select * into r from public.project_requests where id = p_request_id for update;
  if not found then
    raise exception 'Project request not found.' using errcode = 'P0002';
  end if;
  if r.status <> 'pending' then
    raise exception 'This request has already been %.', r.status using errcode = 'P0001';
  end if;

  update public.project_requests
  set status = 'rejected',
      reviewed_by = v_actor,
      reviewed_at = now(),
      review_note = v_reason
  where id = p_request_id;

  insert into public.audit_events (project_id, actor_user_id, actor_role, event_type, entity_type, entity_id, payload)
  values (
    null, v_actor, 'super_admin', 'project_request.rejected', 'project_request', p_request_id::text,
    jsonb_build_object('reference', r.reference, 'reason', v_reason)
  );

  return jsonb_build_object('reference', r.reference);
end;
$$;

-- ---------- Save kit and targets ----------
-- p_kit: {id?, name, version, active}
-- p_targets: [{id?, target_name, aliases[], fluorophore, channel, plate_wells[], control_type, ct_min, ct_max, sort_order}]
-- Targets missing from p_targets are deleted (fails if compiled data references them).
create or replace function public.save_kit(p_kit jsonb, p_targets jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_kit_id uuid := nullif(p_kit ->> 'id', '')::uuid;
  v_keep uuid[];
  t jsonb;
begin
  if v_actor is null or not private.is_super_admin() then
    raise exception 'Only a super admin can edit kits.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_targets) is distinct from 'array' or jsonb_array_length(p_targets) = 0 then
    raise exception 'A kit needs at least one target.' using errcode = '22023';
  end if;

  if v_kit_id is null then
    insert into public.kits (name, version, active)
    values (btrim(p_kit ->> 'name'), btrim(p_kit ->> 'version'), coalesce((p_kit ->> 'active')::boolean, true))
    returning id into v_kit_id;
  else
    update public.kits
    set name = btrim(p_kit ->> 'name'),
        version = btrim(p_kit ->> 'version'),
        active = coalesce((p_kit ->> 'active')::boolean, true)
    where id = v_kit_id;
    if not found then
      raise exception 'Kit not found.' using errcode = 'P0002';
    end if;
  end if;

  select coalesce(array_agg((x ->> 'id')::uuid), '{}')
  into v_keep
  from jsonb_array_elements(p_targets) as x
  where nullif(x ->> 'id', '') is not null;

  delete from public.kit_targets kt
  where kt.kit_id = v_kit_id
    and not (kt.id = any (v_keep));

  for t in select value from jsonb_array_elements(p_targets) loop
    if nullif(t ->> 'id', '') is null then
      insert into public.kit_targets (
        kit_id, target_name, aliases, fluorophore, channel, plate_wells, control_type, ct_min, ct_max, sort_order
      )
      values (
        v_kit_id,
        btrim(t ->> 'target_name'),
        array(select jsonb_array_elements_text(coalesce(t -> 'aliases', '[]'::jsonb))),
        btrim(t ->> 'fluorophore'),
        nullif(btrim(t ->> 'channel'), ''),
        array(select jsonb_array_elements_text(coalesce(t -> 'plate_wells', '[]'::jsonb))),
        coalesce(t ->> 'control_type', 'none')::public.kit_control_type,
        (t ->> 'ct_min')::numeric,
        (t ->> 'ct_max')::numeric,
        coalesce((t ->> 'sort_order')::integer, 0)
      );
    else
      update public.kit_targets
      set target_name = btrim(t ->> 'target_name'),
          aliases = array(select jsonb_array_elements_text(coalesce(t -> 'aliases', '[]'::jsonb))),
          fluorophore = btrim(t ->> 'fluorophore'),
          channel = nullif(btrim(t ->> 'channel'), ''),
          plate_wells = array(select jsonb_array_elements_text(coalesce(t -> 'plate_wells', '[]'::jsonb))),
          control_type = coalesce(t ->> 'control_type', 'none')::public.kit_control_type,
          ct_min = (t ->> 'ct_min')::numeric,
          ct_max = (t ->> 'ct_max')::numeric,
          sort_order = coalesce((t ->> 'sort_order')::integer, 0)
      where id = (t ->> 'id')::uuid
        and kit_id = v_kit_id;
      if not found then
        raise exception 'Target % does not belong to this kit.', t ->> 'id' using errcode = 'P0002';
      end if;
    end if;
  end loop;

  insert into public.audit_events (project_id, actor_user_id, actor_role, event_type, entity_type, entity_id, payload)
  values (
    null, v_actor, 'super_admin', 'kit.saved', 'kit', v_kit_id::text,
    jsonb_build_object('name', p_kit ->> 'name', 'version', p_kit ->> 'version', 'targets', jsonb_array_length(p_targets))
  );

  return v_kit_id;
end;
$$;

revoke all on function
  public.approve_project_request(uuid, text),
  public.reject_project_request(uuid, text),
  public.save_kit(jsonb, jsonb)
from public, anon;

grant execute on function
  public.approve_project_request(uuid, text),
  public.reject_project_request(uuid, text),
  public.save_kit(jsonb, jsonb)
to authenticated;
