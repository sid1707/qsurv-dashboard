-- Plate composition is chosen on each upload, as in the AMR portal, instead of
-- once in the project's plate layout: one sample, or 2-3 samples from multiple
-- dates or multiple sites. The project's layout holds one sample and the
-- others are placed from it when the run is checked.

alter table public.upload_batches
  add column if not exists plate_samples smallint not null default 1,
  add column if not exists plate_mode text;

alter table public.upload_batches
  drop constraint if exists upload_batches_plate_samples_range,
  add constraint upload_batches_plate_samples_range check (plate_samples between 1 and 3),
  drop constraint if exists upload_batches_plate_mode_option,
  add constraint upload_batches_plate_mode_option check (
    (plate_samples = 1 and plate_mode is null)
    or (plate_samples > 1 and plate_mode in ('dates', 'sites'))
  );

comment on column public.upload_batches.plate_samples is
  'Samples on the plate, chosen by the centre on upload. Several samples are split into one file per sample.';
comment on column public.upload_batches.plate_mode is
  'How several samples differ: dates (split by collection date) or sites (split by site identifier). Null for one sample.';

-- Same as 20261005150000_centre_file_names_and_splits.sql, plus the
-- composition: a centre sets it when it starts the upload and cannot change it.
create or replace function private.guard_centre_upload_batch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Two steps: "or" does not promise to skip the second test, and the service
  -- role cannot run the private helpers.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if private.can_manage_project(new.project_id) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.upload_status <> 'draft' or new.processing_status is not null or new.submitted_at is not null
       or new.split_mode <> 'none' or new.logical_file_count <> 1 then
      raise exception 'New uploads start as drafts.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.upload_status is distinct from old.upload_status
     or new.processing_status is distinct from old.processing_status
     or new.submitted_at is distinct from old.submitted_at
     or new.warning_acknowledged is distinct from old.warning_acknowledged
     or new.kit_id is distinct from old.kit_id
     or new.project_id is distinct from old.project_id
     or new.centre_id is distinct from old.centre_id
     or new.uploaded_by is distinct from old.uploaded_by
     or new.rejection_reason is distinct from old.rejection_reason
     or new.compile_notes is distinct from old.compile_notes
     or new.split_mode is distinct from old.split_mode
     or new.logical_file_count is distinct from old.logical_file_count
     or new.plate_samples is distinct from old.plate_samples
     or new.plate_mode is distinct from old.plate_mode then
    raise exception 'Upload status is set by QSurv after validation.' using errcode = '42501';
  end if;
  return new;
end;
$$;
