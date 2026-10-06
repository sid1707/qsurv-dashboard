-- Onboarding form v2:
--   * Kit targets are grouped into multiplex tubes (PPMs), and kits say how the
--     tubes sit on a 96-well plate. Kits carry rule defaults from their insert.
--   * Requests and projects record several qPCR instruments, the plate layout the
--     nodal lab designed, and the quality-check and compilation rules it chose.
--   * The real Quantiplus kits replace the placeholder kits on the form.

-- ---------- Kits ----------
alter table public.kits
  add column layout_orientation text not null default 'tubes_in_rows',
  add column rule_defaults jsonb not null default '{}'::jsonb,
  add constraint kits_layout_orientation_option
    check (layout_orientation in ('tubes_in_rows', 'tubes_in_columns')),
  add constraint kits_rule_defaults_object check (jsonb_typeof(rule_defaults) = 'object');

comment on column public.kits.layout_orientation is
  'Preset plate layout: tubes_in_rows puts one tube per plate row (samples across columns); tubes_in_columns puts one tube per column.';
comment on column public.kits.rule_defaults is
  'Kit-specific defaults for rule parameters, keyed by rule id, e.g. {"ntc_amplification": {"ct": 38}}.';

alter table public.kit_targets
  add column tube_name text not null default 'Tube 1',
  add column tube_order integer not null default 1,
  add column std_slope numeric,
  add column std_intercept numeric,
  add column pc_copies numeric,
  add constraint kit_targets_tube_name_not_blank check (char_length(btrim(tube_name)) > 0),
  add constraint kit_targets_std_curve_pair check ((std_slope is null) = (std_intercept is null)),
  add constraint kit_targets_pc_copies_positive check (pc_copies is null or pc_copies > 0),
  -- Two targets read in the same dye in the same tube cannot be told apart.
  -- Deferred so the editor can swap dyes between two targets in one save.
  add constraint kit_targets_tube_fluorophore_key unique (kit_id, tube_name, fluorophore)
    deferrable initially deferred;

comment on column public.kit_targets.tube_name is 'Multiplex tube (primer-probe mix) the target is read in.';
comment on column public.kit_targets.pc_copies is 'Positive control concentration from the kit insert (copies/mL).';

-- ---------- Requests and projects ----------
alter table public.project_requests
  add column instruments text[],
  add column plate_layout jsonb,
  add column qc_rules jsonb,
  add column compile_rules jsonb,
  add constraint project_requests_instruments_option check (
    instruments is null
    or (cardinality(instruments) > 0
        and instruments <@ array['quantstudio_5', 'biorad_cfx96', 'other']::text[])
  ),
  add constraint project_requests_plate_layout_object
    check (plate_layout is null or jsonb_typeof(plate_layout) = 'object'),
  add constraint project_requests_qc_rules_object
    check (qc_rules is null or jsonb_typeof(qc_rules) = 'object'),
  add constraint project_requests_compile_rules_object
    check (compile_rules is null or jsonb_typeof(compile_rules) = 'object');

update public.project_requests set instruments = array[instrument] where instrument is not null;

alter table public.projects
  add column instruments text[],
  add column plate_layout jsonb,
  add column qc_rules jsonb,
  add column compile_rules jsonb,
  add constraint projects_instruments_option check (
    instruments is null
    or (cardinality(instruments) > 0
        and instruments <@ array['quantstudio_5', 'biorad_cfx96', 'other']::text[])
  ),
  add constraint projects_plate_layout_object
    check (plate_layout is null or jsonb_typeof(plate_layout) = 'object'),
  add constraint projects_qc_rules_object
    check (qc_rules is null or jsonb_typeof(qc_rules) = 'object'),
  add constraint projects_compile_rules_object
    check (compile_rules is null or jsonb_typeof(compile_rules) = 'object');

update public.projects set instruments = array[instrument] where instrument is not null;

comment on column public.project_requests.plate_layout is
  'Plate layout designed on the onboarding form: tubes and well roles (unknown, pc, nc) per plate.';
comment on column public.project_requests.qc_rules is
  'Quality-check rules chosen on the onboarding form: {rule_id: {enabled, params}}.';
comment on column public.project_requests.compile_rules is
  'Compilation rules chosen on the onboarding form: {rule_id: {enabled, params}}.';

-- ---------- Approve: also copy instruments, layout and rules ----------
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
    kit_id, instrument, instruments, instrument_other, user_tier, funding_agency, ethics_reference,
    data_management, data_compilation, data_plotting, plate_layout, qc_rules, compile_rules,
    status, request_id
  )
  values (
    r.requested_code, r.project_title, r.objective, r.start_date, r.end_date, r.sample_type,
    r.sample_type_other, r.frequency, r.kit_id, r.instrument, r.instruments, r.instrument_other,
    r.user_tier, r.funding_agency, r.ethics_reference, r.data_management, r.data_compilation,
    r.data_plotting, r.plate_layout, r.qc_rules, r.compile_rules, 'active', r.id
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

-- ---------- Save kit: tubes, layout orientation and standard curves ----------
-- p_kit: {id?, name, version, active, layout_orientation}
-- p_targets: [{id?, target_name, aliases[], fluorophore, channel, plate_wells[], control_type,
--              ct_min, ct_max, sort_order, tube_name, tube_order, std_slope, std_intercept, pc_copies}]
-- rule_defaults are not edited here and keep their current value.
create or replace function public.save_kit(p_kit jsonb, p_targets jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_kit_id uuid := nullif(p_kit ->> 'id', '')::uuid;
  v_orientation text := coalesce(nullif(p_kit ->> 'layout_orientation', ''), 'tubes_in_rows');
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
    insert into public.kits (name, version, active, layout_orientation)
    values (
      btrim(p_kit ->> 'name'), btrim(p_kit ->> 'version'),
      coalesce((p_kit ->> 'active')::boolean, true), v_orientation
    )
    returning id into v_kit_id;
  else
    update public.kits
    set name = btrim(p_kit ->> 'name'),
        version = btrim(p_kit ->> 'version'),
        active = coalesce((p_kit ->> 'active')::boolean, true),
        layout_orientation = v_orientation
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
        kit_id, target_name, aliases, fluorophore, channel, plate_wells, control_type, ct_min, ct_max,
        sort_order, tube_name, tube_order, std_slope, std_intercept, pc_copies
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
        coalesce((t ->> 'sort_order')::integer, 0),
        coalesce(nullif(btrim(t ->> 'tube_name'), ''), 'Tube 1'),
        coalesce((t ->> 'tube_order')::integer, 1),
        (t ->> 'std_slope')::numeric,
        (t ->> 'std_intercept')::numeric,
        (t ->> 'pc_copies')::numeric
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
          sort_order = coalesce((t ->> 'sort_order')::integer, 0),
          tube_name = coalesce(nullif(btrim(t ->> 'tube_name'), ''), 'Tube 1'),
          tube_order = coalesce((t ->> 'tube_order')::integer, 1),
          std_slope = (t ->> 'std_slope')::numeric,
          std_intercept = (t ->> 'std_intercept')::numeric,
          pc_copies = (t ->> 'pc_copies')::numeric
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

-- ---------- Real kits ----------
-- Placeholders stay for any project already using them, but leave the form.
update public.kits set active = false where version = '0.1-placeholder';

-- Thresholds from the kit inserts (target cut-off Ct 38, MS-2 exogenous control 35)
-- and from the vrdl-next-platform rules (endogenous control 35, low-Ct cut-offs).
insert into public.kits (name, version, active, layout_orientation, rule_defaults)
values
  (
    'Quantiplus ENV-AMR (8 tube)', 'ENV-AMR', true, 'tubes_in_rows',
    '{
      "ntc_amplification": {"ct": 38},
      "exogenous_ic_amplified": {"ct": 35},
      "endogenous_ic_high_ct": {"ct": 35},
      "endogenous_gate": {"ct": 35},
      "low_ct_warning": {"ct": 10, "targetOverrides": {"CTX-M": 20, "MTB": 30, "mecA": 30, "MCR 1/2/6": 20, "pvl": 30}},
      "low_ct_clamp": {"ct": 14, "targetOverrides": {"MCR 1/2/6": 35, "MCR 3": 17.5, "MCR 8": 17.5, "MCR 5/9/10": 17.5, "MCR 7": 17.5, "MCR 4": 17.5, "mecA": 17.5, "MTB": 20, "nuc": 30, "pvl": 30}}
    }'::jsonb
  ),
  (
    'Quantiplus ENV-AMR V2 (15 tube)', 'PI/ENVAMR-02', true, 'tubes_in_rows',
    '{
      "ntc_amplification": {"ct": 38},
      "exogenous_ic_amplified": {"ct": 35},
      "endogenous_ic_high_ct": {"ct": 35},
      "endogenous_gate": {"ct": 35},
      "low_ct_warning": {"ct": 10, "targetOverrides": {"CTX-M": 20, "MTB": 30, "mecA": 30, "MCR 1/2/6": 20, "pvl": 30}},
      "low_ct_clamp": {"ct": 14, "targetOverrides": {"MCR 1/2/6": 35, "MCR 3": 17.5, "MCR 8": 17.5, "MCR 5/9/10": 17.5, "MCR 7": 17.5, "MCR 4": 17.5, "mecA": 17.5, "MTB": 20, "nuc": 30, "pvl": 30}}
    }'::jsonb
  ),
  (
    'Quantiplus Waste Water Surveillance (10 tube)', 'PI/QLWWS-02', true, 'tubes_in_columns',
    '{
      "ntc_amplification": {"ct": 38},
      "exogenous_ic_amplified": {"ct": 35},
      "endogenous_ic_high_ct": {"ct": 35},
      "endogenous_gate": {"ct": 35}
    }'::jsonb
  )
on conflict (name, version) do nothing;

-- ENV-AMR tubes 1-8 are shared by both ENV-AMR kits. Standard curves (from
-- vrdl-next-platform lib/compile/targets-config.ts) are only set on the 8-tube kit.
-- Channels are the Rotor-Gene names for each dye, from the ENV-AMR insert.
insert into public.kit_targets (
  kit_id, target_name, aliases, fluorophore, channel, control_type, ct_max, sort_order,
  tube_name, tube_order, pc_copies, std_slope, std_intercept
)
select k.id, c.target_name, c.aliases, c.fluorophore,
       case c.fluorophore when 'FAM' then 'Green' when 'VIC/HEX' then 'Yellow'
                          when 'Texas Red/ROX' then 'Orange' when 'Cy5' then 'Red' end,
       c.control_type::public.kit_control_type, c.ct_max, c.sort_order,
       c.tube_name, c.tube_order, c.pc_copies,
       case when k.version = 'ENV-AMR' then c.std_slope end,
       case when k.version = 'ENV-AMR' then c.std_intercept end
from public.kits k
join (
  values
    (1, 'NVK', 'NDM', '{}'::text[], 'FAM', 'none', 38, 2.0e6, -2.853644319, 40.68003349, 1),
    (1, 'NVK', 'KPC', '{}'::text[], 'VIC/HEX', 'none', 38, 1.6e6, -3.122132549, 42.672533, 2),
    (1, 'NVK', 'VIM', '{}'::text[], 'Texas Red/ROX', 'none', 38, 1.9e6, -3.444478617, 44.23191606, 3),
    (2, 'IOI', 'IMP', '{}'::text[], 'FAM', 'none', 38, 1.9e6, -2.728785286, 39.34393914, 4),
    (2, 'IOI', 'OXA', '{}'::text[], 'VIC/HEX', 'none', 38, 2.1e6, -2.898181764, 39.82236388, 5),
    (2, 'IOI', 'IC', '{"MS-2","MS2","IC_ex"}'::text[], 'Texas Red/ROX', 'exogenous_control', 35, 1.0e5, -3.060306086, 40.79872998, 6),
    (3, 'MRSA', 'mecA', '{"mec A"}'::text[], 'FAM', 'none', 38, 1.2e6, -3.282832971, 42.25512858, 7),
    (3, 'MRSA', 'pvl', '{}'::text[], 'VIC/HEX', 'none', 38, 3.0e6, -3.255559839, 43.25320725, 8),
    (3, 'MRSA', 'nuc', '{}'::text[], 'Texas Red/ROX', 'none', 38, 2.0e6, -3.108363102, 38.61363341, 9),
    (4, 'ESBLs', 'SHV', '{}'::text[], 'FAM', 'none', 38, 2.9e6, -3.229451886, 43.10607063, 10),
    (4, 'ESBLs', 'CTX-M', '{"CTXM"}'::text[], 'VIC/HEX', 'none', 38, 2.5e6, -2.52554831, 35.93244544, 11),
    (4, 'ESBLs', 'CMY', '{}'::text[], 'Texas Red/ROX', 'none', 38, 2.9e6, -3.163297878, 43.03213517, 12),
    (5, 'Vancomycin', 'vanA', '{"van A"}'::text[], 'FAM', 'none', 38, 2.3e6, -3.2167264, 40.91614762, 13),
    (5, 'Vancomycin', 'vanB', '{"van B"}'::text[], 'VIC/HEX', 'none', 38, 2.8e6, -3.31045194, 45.90358924, 14),
    (5, 'Vancomycin', 'vanM', '{"van M"}'::text[], 'Texas Red/ROX', 'none', 38, 2.4e6, -3.428140612, 43.42013787, 15),
    (6, 'ENV MTB', 'MTB', '{}'::text[], 'FAM', 'none', 38, 2.0e6, -3.322519234, 42.09922454, 16),
    (6, 'ENV MTB', 'ENT', '{"Enterobacter","IC_en","16S"}'::text[], 'VIC/HEX', 'endogenous_control', 35, 1.0e6, -3.087614084, 40.03578127, 17),
    (7, 'mcr 1', 'MCR 1/2/6', '{"mcr1","mcr126","mcr 1/2/6"}'::text[], 'FAM', 'none', 38, 2.3e6, -2.926002749, 38.57021318, 18),
    (7, 'mcr 1', 'MCR 3', '{"mcr3"}'::text[], 'VIC/HEX', 'none', 38, 2.9e6, -2.95611088, 38.98434468, 19),
    (7, 'mcr 1', 'MCR 8', '{"mcr8"}'::text[], 'Texas Red/ROX', 'none', 38, 2.5e6, -3.106494058, 39.99436906, 20),
    (8, 'mcr 2', 'MCR 5/9/10', '{"mcr5910","mcr 5/9/10"}'::text[], 'FAM', 'none', 38, 2.5e6, -2.601474752, 36.08287691, 21),
    (8, 'mcr 2', 'MCR 7', '{"mcr7"}'::text[], 'VIC/HEX', 'none', 38, 2.3e6, -2.604560776, 37.56348003, 22),
    (8, 'mcr 2', 'MCR 4', '{"mcr4"}'::text[], 'Texas Red/ROX', 'none', 38, 2.5e6, -2.751414317, 39.21251622, 23)
) as c(tube_order, tube_name, target_name, aliases, fluorophore, control_type, ct_max, pc_copies,
       std_slope, std_intercept, sort_order) on true
where (k.name, k.version) in (
  ('Quantiplus ENV-AMR (8 tube)', 'ENV-AMR'),
  ('Quantiplus ENV-AMR V2 (15 tube)', 'PI/ENVAMR-02')
)
on conflict (kit_id, target_name) do nothing;

-- ENV-AMR V2 tubes 9-15 (PI/ENVAMR-02).
insert into public.kit_targets (
  kit_id, target_name, aliases, fluorophore, channel, control_type, ct_max, sort_order,
  tube_name, tube_order, pc_copies
)
select k.id, t.target_name, t.aliases, t.fluorophore,
       case t.fluorophore when 'FAM' then 'Green' when 'VIC/HEX' then 'Yellow'
                          when 'Texas Red/ROX' then 'Orange' when 'Cy5' then 'Red' end,
       'none'::public.kit_control_type, 38, t.sort_order, t.tube_name, t.tube_order, t.pc_copies
from public.kits k
join (
  values
    (9, 'ENV AMR Tube-9', 'Pseudomonas aeruginosa', '{"P. aeruginosa"}'::text[], 'Texas Red/ROX', 2.3e6, 24),
    (9, 'ENV AMR Tube-9', 'Streptococcus pneumoniae', '{"S. pneumoniae"}'::text[], 'VIC/HEX', 2.0e6, 25),
    (9, 'ENV AMR Tube-9', 'Klebsiella pneumoniae', '{"K. pneumoniae"}'::text[], 'Cy5', 2.3e6, 26),
    (10, 'Salmonella', 'Salmonella Typhi', '{"S. Typhi"}'::text[], 'Texas Red/ROX', 1.0e6, 27),
    (10, 'Salmonella', 'Salmonella Paratyphi', '{"S. Paratyphi"}'::text[], 'VIC/HEX', 2.3e6, 28),
    (11, 'Chloramphenicol', 'catA1', '{"CatA1"}'::text[], 'FAM', 1.0e6, 29),
    (12, 'Trimethoprim', 'dfrA5-14', '{"dfrA5 - 14","dfrA"}'::text[], 'FAM', 2.9e6, 30),
    (13, 'Tetracycline', 'tetA', '{"TetA"}'::text[], 'FAM', 1.0e6, 31),
    (14, 'Sulfonamide', 'Sul1/4', '{"Sul1&4","Sul 1&4"}'::text[], 'FAM', 2.0e6, 32),
    (14, 'Sulfonamide', 'Sul2/3', '{"Sul2&3","Sul 2&3"}'::text[], 'VIC/HEX', 1.0e6, 33),
    (15, 'ABB & EF', 'Enterococcus faecium', '{"E. faecium"}'::text[], 'Texas Red/ROX', 2.0e6, 34),
    (15, 'ABB & EF', 'Acinetobacter baumannii', '{"A. baumannii"}'::text[], 'VIC/HEX', 2.9e6, 35)
) as t(tube_order, tube_name, target_name, aliases, fluorophore, pc_copies, sort_order) on true
where k.name = 'Quantiplus ENV-AMR V2 (15 tube)' and k.version = 'PI/ENVAMR-02'
on conflict (kit_id, target_name) do nothing;

-- Waste Water Surveillance kit (PI/QLWWS-02).
insert into public.kit_targets (
  kit_id, target_name, aliases, fluorophore, channel, control_type, ct_max, sort_order,
  tube_name, tube_order
)
select k.id, t.target_name, t.aliases, t.fluorophore,
       case t.fluorophore when 'FAM' then 'Green' when 'VIC/HEX' then 'Yellow'
                          when 'Texas Red/ROX' then 'Orange' when 'Cy5' then 'Red' end,
       t.control_type::public.kit_control_type, t.ct_max, t.sort_order, t.tube_name, t.tube_order
from public.kits k
join (
  values
    (1, 'RP1 PPM 1', 'SARS-CoV-2', '{"SARS CoV 2"}'::text[], 'FAM', 'none', 38, 1),
    (1, 'RP1 PPM 1', 'Influenza B', '{"Flu B"}'::text[], 'Cy5', 'none', 38, 2),
    (2, 'RP1 PPM 3', 'H3N2', '{}'::text[], 'FAM', 'none', 38, 3),
    (2, 'RP1 PPM 3', 'H1N1 (pdm09)', '{"H1N1","H1N1pdm09"}'::text[], 'VIC/HEX', 'none', 38, 4),
    (3, 'RP1 PPM 7', 'RSV A&B', '{"RSV"}'::text[], 'FAM', 'none', 38, 5),
    (3, 'RP1 PPM 7', 'Influenza A', '{"Flu A"}'::text[], 'VIC/HEX', 'none', 38, 6),
    (4, 'Noro PPM', 'Norovirus', '{"Noro Virus","Noro"}'::text[], 'FAM', 'none', 38, 7),
    (4, 'Noro PPM', 'IC', '{"MS-2","MS2","Exogenous IC"}'::text[], 'Texas Red/ROX', 'exogenous_control', 35, 8),
    (5, 'Rota PPM', 'Rotavirus', '{"Rota Virus","Rota"}'::text[], 'FAM', 'none', 38, 9),
    (5, 'Rota PPM', 'PMMoV', '{"PMMoV IC","Endogenous IC"}'::text[], 'VIC/HEX', 'endogenous_control', 35, 10),
    (6, 'HAV & HEV PPM', 'Hepatitis A', '{"HAV"}'::text[], 'FAM', 'none', 38, 11),
    (6, 'HAV & HEV PPM', 'Hepatitis E', '{"HEV"}'::text[], 'VIC/HEX', 'none', 38, 12),
    (7, 'ADV & ENT PPM', 'Adenovirus', '{"Adeno Virus","ADV"}'::text[], 'FAM', 'none', 38, 13),
    (7, 'ADV & ENT PPM', 'Enterovirus', '{"Entero Virus","EV"}'::text[], 'Texas Red/ROX', 'none', 38, 14),
    (8, 'MPV Fast PPM', 'Mpox (West African)', '{"MPXV West African"}'::text[], 'FAM', 'none', 38, 15),
    (8, 'MPV Fast PPM', 'Mpox (Congo Basin)', '{"MPXV Congo Basin"}'::text[], 'VIC/HEX', 'none', 38, 16),
    (8, 'MPV Fast PPM', 'Orthopoxvirus', '{"Ortho-pox genus"}'::text[], 'Texas Red/ROX', 'none', 38, 17),
    (9, 'Measles Fast PPM', 'Measles genotypes', '{"Measles subtypes"}'::text[], 'FAM', 'none', 38, 18),
    (9, 'Measles Fast PPM', 'Measles vaccine type', '{}'::text[], 'VIC/HEX', 'none', 38, 19),
    (10, 'Salmonella & Rubella PPM', 'Rubella', '{"Rubella virus"}'::text[], 'FAM', 'none', 38, 20),
    (10, 'Salmonella & Rubella PPM', 'Salmonella Paratyphi', '{"S. Paratyphi"}'::text[], 'VIC/HEX', 'none', 38, 21),
    (10, 'Salmonella & Rubella PPM', 'Salmonella Typhi', '{"S. Typhi"}'::text[], 'Texas Red/ROX', 'none', 38, 22)
) as t(tube_order, tube_name, target_name, aliases, fluorophore, control_type, ct_max, sort_order) on true
where k.name = 'Quantiplus Waste Water Surveillance (10 tube)' and k.version = 'PI/QLWWS-02'
on conflict (kit_id, target_name) do nothing;
