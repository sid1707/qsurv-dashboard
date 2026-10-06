-- Upload file names and multi-sample plates.
--   * File names are <Centre ID>_<Centre name>_<Location>_<DDMMYY>. The project
--     admin gives each centre its ID (centres.code); the name and location part
--     (centres.file_code) is derived from the centre and fixed once it uploads.
--   * A plate can carry several samples (from several dates or sites). Each
--     upload then records every collection date, and the run is split into one
--     file per sample, as in the AMR portal (upload_split_artifacts).

-- ---------- Centre ID and file code ----------
alter table public.centres
  add column if not exists code text,
  add column if not exists file_code text;

alter table public.centres
  drop constraint if exists centres_code_format,
  add constraint centres_code_format check (code is null or code ~ '^[A-Z0-9-]{1,20}$');

comment on column public.centres.code is
  'Centre ID given by the project admin, e.g. C01. First part of every upload file name.';
comment on column public.centres.file_code is
  'Centre name and location without spaces, e.g. AIIMS_NewDelhi. Second part of upload file names; fixed once the centre has uploads.';

create unique index if not exists idx_centres_project_code on public.centres(project_id, code) where code is not null;

-- Keep in step with centreFileCode in lib/centres/file-name.ts.
create or replace function private.centre_file_code(p_name text, p_location text)
returns text
language sql
immutable
set search_path = ''
as $$
  select array_to_string(
    array_remove(array[
      nullif(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9]', '', 'g'), ''),
      nullif(regexp_replace(coalesce(p_location, ''), '[^A-Za-z0-9]', '', 'g'), '')
    ], null),
    '_'
  );
$$;

create or replace function private.centre_has_uploads(p_centre_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.upload_batches b
    where b.centre_id = p_centre_id and b.upload_status <> 'draft'
  );
$$;

create or replace function private.maintain_centre_file_names()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.code := nullif(upper(btrim(new.code)), '');

  if tg_op = 'INSERT' then
    new.file_code := private.centre_file_code(new.name, new.city);
    return new;
  end if;

  -- Once files have been uploaded under them, the ID and the file code stay.
  if private.centre_has_uploads(old.id) then
    if new.code is distinct from old.code then
      raise exception 'The centre ID cannot change once the centre has uploaded files.' using errcode = 'P0001';
    end if;
    new.file_code := old.file_code;
  elsif new.name is distinct from old.name or new.city is distinct from old.city or new.file_code is null then
    new.file_code := private.centre_file_code(new.name, new.city);
  end if;
  return new;
end;
$$;

revoke all on function
  private.centre_file_code(text, text),
  private.centre_has_uploads(uuid),
  private.maintain_centre_file_names()
from public, anon, authenticated;

drop trigger if exists trg_centres_file_names on public.centres;
create trigger trg_centres_file_names
before insert or update on public.centres
for each row execute function private.maintain_centre_file_names();

update public.centres set file_code = private.centre_file_code(name, city) where file_code is null;

-- ---------- Uploads: every collection date, and how the run was split ----------
alter table public.upload_batches
  add column if not exists sample_collection_dates date[],
  add column if not exists split_mode text not null default 'none',
  add column if not exists logical_file_count integer not null default 1;

alter table public.upload_batches
  drop constraint if exists upload_batches_split_mode_option,
  add constraint upload_batches_split_mode_option check (split_mode in ('none', 'by_date', 'by_identifier'));

comment on column public.upload_batches.sample_collection_dates is
  'Every collection date on the plate (one per sample for multi-date plates). sample_collection_date is the first.';

update public.upload_batches
set sample_collection_dates = array[sample_collection_date]
where sample_collection_dates is null and sample_collection_date is not null;

-- Pipeline columns stay the server's (see 20261005140000_centre_uploads.sql).
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
     or new.logical_file_count is distinct from old.logical_file_count then
    raise exception 'Upload status is set by QSurv after validation.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------- Split files ----------
create table if not exists public.upload_split_artifacts (
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid not null,
  project_id uuid not null,
  centre_id uuid not null,
  split_index integer not null,
  split_mode text not null,
  split_key text not null,
  display_filename text not null,
  collection_date date,
  storage_bucket text not null,
  storage_path text not null,
  created_at timestamptz not null default now(),
  foreign key (upload_batch_id, project_id, centre_id)
    references public.upload_batches(id, project_id, centre_id) on delete cascade,
  unique (upload_batch_id, split_index),
  constraint upload_split_artifacts_mode_option check (split_mode in ('by_date', 'by_identifier'))
);

comment on table public.upload_split_artifacts is
  'One row per sample split out of a multi-sample run (vrdl-next-platform parity). Written by the server with the service role.';

create index if not exists idx_upload_split_artifacts_batch
  on public.upload_split_artifacts(upload_batch_id, project_id, centre_id);
create index if not exists idx_upload_split_artifacts_duplicate
  on public.upload_split_artifacts(project_id, centre_id, display_filename);

alter table public.upload_split_artifacts enable row level security;

drop policy if exists "upload split artifacts read" on public.upload_split_artifacts;
create policy "upload split artifacts read"
on public.upload_split_artifacts
for select
to authenticated
using (private.can_access_centre(project_id, centre_id));

drop policy if exists "upload split artifacts manage" on public.upload_split_artifacts;
create policy "upload split artifacts manage"
on public.upload_split_artifacts
for all
to authenticated
using (private.can_manage_project(project_id))
with check (private.can_manage_project(project_id));

revoke all on public.upload_split_artifacts from anon, authenticated;
grant select, insert, update, delete on public.upload_split_artifacts to authenticated;
grant all on public.upload_split_artifacts to service_role;
