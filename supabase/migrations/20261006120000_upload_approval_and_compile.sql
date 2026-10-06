-- Upload approval queue (/p/[code]/admin/approvals) and compiled data.
--   * The project admin approves or rejects a submitted upload. Approving can
--     carry the compiled measurements, which the server builds from the stored
--     run with the project's kit and compile rules (lib/compile). Writing the
--     rows and approving happen in one transaction, so an upload is never
--     approved with half its data.
--   * Both functions run as the caller: RLS and can_manage_project decide who
--     may review. A project admin can already write compiled_measurements
--     directly, so these grant nothing new; they add the checks and the audit.

-- ---------- Approve (and store the compiled measurements) ----------
-- p_measurements: [{kit_target_id, collection_date, sample_label, target_name,
--   cq_value, cq_sd, normalized_cq, copy_number, copy_number_sd, metric_payload}]
create or replace function public.approve_upload(
  p_upload_id uuid,
  p_measurements jsonb default '[]'::jsonb,
  p_compile_notes text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_batch public.upload_batches%rowtype;
  v_run_id uuid;
  v_run_passed boolean;
  v_kit_id uuid;
  v_compiles boolean;
  v_expected integer;
  v_rows integer := 0;
  v_status public.upload_status;
begin
  if v_actor is null then
    raise exception 'Sign in to review uploads.' using errcode = '42501';
  end if;

  select * into v_batch from public.upload_batches b where b.id = p_upload_id for update;
  if not found or not private.can_manage_project(v_batch.project_id) then
    raise exception 'Upload not found.' using errcode = 'P0002';
  end if;

  if v_batch.approval_status = 'approved' then
    return jsonb_build_object(
      'already_approved', true,
      'upload_status', v_batch.upload_status,
      'rows_written', (select count(*) from public.compiled_measurements m where m.upload_batch_id = p_upload_id)
    );
  end if;
  if v_batch.approval_status = 'rejected' then
    raise exception 'This upload was rejected and cannot be approved.' using errcode = 'P0001';
  end if;
  if not v_batch.is_active or v_batch.upload_status <> 'uploaded' or v_batch.processing_status is distinct from 'completed' then
    raise exception 'This upload is not ready for approval.' using errcode = 'P0001';
  end if;

  select r.id, r.passed into v_run_id, v_run_passed
  from public.validation_runs r
  where r.upload_batch_id = p_upload_id
  order by r.created_at desc
  limit 1;
  if v_run_id is null or not v_run_passed then
    raise exception 'Validation did not pass; cannot approve.' using errcode = 'P0001';
  end if;

  if p_measurements is null or jsonb_typeof(p_measurements) <> 'array' then
    raise exception 'Measurements must be a list.' using errcode = '22023';
  end if;
  v_expected := jsonb_array_length(p_measurements);

  select p.kit_id, p.data_compilation into v_kit_id, v_compiles from public.projects p where p.id = v_batch.project_id;
  if v_expected > 0 and not v_compiles then
    raise exception 'Data compilation is not switched on for this project.' using errcode = 'P0001';
  end if;

  -- A retried approval replaces anything an earlier attempt left behind.
  delete from public.compiled_measurements m where m.upload_batch_id = p_upload_id;

  insert into public.compiled_measurements (
    upload_batch_id, validation_run_id, project_id, centre_id, kit_target_id, collection_date,
    sample_label, target_name, cq_value, cq_sd, normalized_cq, copy_number, copy_number_sd, metric_payload
  )
  select p_upload_id, v_run_id, v_batch.project_id, v_batch.centre_id, m.kit_target_id, m.collection_date,
         nullif(btrim(m.sample_label), ''), m.target_name, m.cq_value, m.cq_sd, m.normalized_cq,
         m.copy_number, m.copy_number_sd, coalesce(m.metric_payload, '{}'::jsonb)
  from jsonb_to_recordset(p_measurements) as m(
    kit_target_id uuid,
    collection_date date,
    sample_label text,
    target_name text,
    cq_value numeric,
    cq_sd numeric,
    normalized_cq numeric,
    copy_number numeric,
    copy_number_sd numeric,
    metric_payload jsonb
  )
  -- Every row names a target of the project's own kit.
  where exists (
    select 1 from public.kit_targets kt
    where kt.id = m.kit_target_id and kt.kit_id = v_kit_id and kt.target_name = m.target_name
  );
  get diagnostics v_rows = row_count;
  if v_rows <> v_expected then
    raise exception 'Compiled rows must name targets of the project''s kit.' using errcode = '22023';
  end if;

  v_status := case when v_rows > 0 then 'compiled' else 'approved' end;
  update public.upload_batches
  set upload_status = v_status,
      approval_status = 'approved',
      approved_by = v_actor,
      approved_at = now(),
      rejection_reason = null,
      compile_notes = nullif(btrim(p_compile_notes), '')
  where id = p_upload_id;

  insert into public.audit_events (project_id, actor_user_id, actor_role, event_type, entity_type, entity_id, payload)
  values (
    v_batch.project_id, v_actor,
    case when private.is_project_admin(v_batch.project_id) then 'project_admin' else 'super_admin' end,
    'upload.approved', 'upload_batch', p_upload_id::text,
    jsonb_build_object('rows_written', v_rows, 'compile_notes', nullif(btrim(p_compile_notes), ''))
  );

  return jsonb_build_object('already_approved', false, 'upload_status', v_status, 'rows_written', v_rows);
end;
$$;

-- ---------- Reject ----------
create or replace function public.reject_upload(p_upload_id uuid, p_reason text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_batch public.upload_batches%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_actor is null then
    raise exception 'Sign in to review uploads.' using errcode = '42501';
  end if;
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'Give a reason of 1 to 1000 characters.' using errcode = '22023';
  end if;

  select * into v_batch from public.upload_batches b where b.id = p_upload_id for update;
  if not found or not private.can_manage_project(v_batch.project_id) then
    raise exception 'Upload not found.' using errcode = 'P0002';
  end if;
  if v_batch.approval_status <> 'pending' or v_batch.upload_status = 'draft' then
    raise exception 'Only submitted uploads awaiting approval can be rejected.' using errcode = 'P0001';
  end if;

  update public.upload_batches
  set upload_status = 'rejected',
      approval_status = 'rejected',
      rejection_reason = v_reason,
      approved_by = v_actor,
      approved_at = now()
  where id = p_upload_id;

  insert into public.audit_events (project_id, actor_user_id, actor_role, event_type, entity_type, entity_id, payload)
  values (
    v_batch.project_id, v_actor,
    case when private.is_project_admin(v_batch.project_id) then 'project_admin' else 'super_admin' end,
    'upload.rejected', 'upload_batch', p_upload_id::text,
    jsonb_build_object('reason', v_reason)
  );
end;
$$;

comment on column public.upload_batches.approved_by is
  'Who reviewed the upload: the approver, or the rejecter when approval_status is rejected.';

-- ---------- Grants ----------
revoke all on function
  public.approve_upload(uuid, jsonb, text),
  public.reject_upload(uuid, text)
from public, anon;

grant execute on function
  public.approve_upload(uuid, jsonb, text),
  public.reject_upload(uuid, text)
to authenticated;
