-- QSurv portal: upload tracking, validation results and compiled measurements.
-- Modelled on the AMR tables. Every row carries project_id and centre_id, and a
-- composite foreign key to its parent so both always match the parent's scope.

-- ---------- Types ----------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'upload_status') then
    create type public.upload_status as enum (
      'draft',
      'uploaded',
      'queued',
      'parsing',
      'validating',
      'waiting_warning_confirmation',
      'compiling',
      'compiled',
      'approved',
      'rejected'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'processing_status') then
    create type public.processing_status as enum (
      'queued',
      'parsing',
      'validating',
      'waiting_warning_confirmation',
      'compiling',
      'completed',
      'failed'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'approval_status') then
    create type public.approval_status as enum ('pending', 'approved', 'rejected');
  end if;

  if not exists (select 1 from pg_type where typname = 'file_kind') then
    create type public.file_kind as enum ('runfile', 'metadata');
  end if;

  if not exists (select 1 from pg_type where typname = 'validation_severity') then
    create type public.validation_severity as enum ('error', 'warning', 'detail');
  end if;
end
$$;

-- ---------- Upload batches ----------
create table if not exists public.upload_batches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  centre_id uuid not null,
  kit_id uuid references public.kits(id),
  uploaded_by uuid not null references public.profiles(user_id),
  upload_status public.upload_status not null default 'draft',
  processing_status public.processing_status,
  approval_status public.approval_status not null default 'pending',
  warning_acknowledged boolean not null default false,
  sample_collection_date date,
  instrument text,
  notes text,
  submitted_at timestamptz,
  approved_by uuid references public.profiles(user_id),
  approved_at timestamptz,
  rejection_reason text,
  compile_notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (centre_id, project_id) references public.centres(id, project_id) on delete cascade,
  unique (id, project_id, centre_id)
);

create index if not exists idx_upload_batches_project_centre
  on public.upload_batches(project_id, centre_id, created_at desc);
create index if not exists idx_upload_batches_centre on public.upload_batches(centre_id, project_id);
create index if not exists idx_upload_batches_status
  on public.upload_batches(project_id, upload_status, approval_status);
create index if not exists idx_upload_batches_uploaded_by on public.upload_batches(uploaded_by);
create index if not exists idx_upload_batches_approved_by on public.upload_batches(approved_by);
create index if not exists idx_upload_batches_kit on public.upload_batches(kit_id);

-- ---------- Upload files ----------
create table if not exists public.upload_files (
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid not null,
  project_id uuid not null,
  centre_id uuid not null,
  file_kind public.file_kind not null,
  original_filename text not null,
  storage_bucket text not null,
  storage_path text not null,
  sha256 text,
  size_bytes bigint,
  mime_type text,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (upload_batch_id, project_id, centre_id)
    references public.upload_batches(id, project_id, centre_id) on delete cascade,
  unique (upload_batch_id, file_kind),
  unique (storage_bucket, storage_path)
);

create index if not exists idx_upload_files_batch
  on public.upload_files(upload_batch_id, project_id, centre_id);
create index if not exists idx_upload_files_project_centre on public.upload_files(project_id, centre_id);

-- ---------- Validation ----------
create table if not exists public.validation_runs (
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid not null,
  project_id uuid not null,
  centre_id uuid not null,
  engine_version text not null,
  passed boolean not null,
  error_count integer not null default 0,
  warning_count integer not null default 0,
  detail_count integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (upload_batch_id, project_id, centre_id)
    references public.upload_batches(id, project_id, centre_id) on delete cascade,
  unique (id, project_id, centre_id)
);

create index if not exists idx_validation_runs_batch
  on public.validation_runs(upload_batch_id, project_id, centre_id);
create index if not exists idx_validation_runs_project_centre on public.validation_runs(project_id, centre_id);

create table if not exists public.validation_issues (
  id bigint generated always as identity primary key,
  validation_run_id uuid not null,
  project_id uuid not null,
  centre_id uuid not null,
  severity public.validation_severity not null,
  issue_code text not null,
  message text not null,
  well text,
  target_name text,
  record_index integer,
  field_name text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (validation_run_id, project_id, centre_id)
    references public.validation_runs(id, project_id, centre_id) on delete cascade
);

create index if not exists idx_validation_issues_run
  on public.validation_issues(validation_run_id, project_id, centre_id);
create index if not exists idx_validation_issues_project_centre
  on public.validation_issues(project_id, centre_id, severity);

-- ---------- Compiled measurements ----------
create table if not exists public.compiled_measurements (
  id bigint generated always as identity primary key,
  upload_batch_id uuid not null,
  validation_run_id uuid references public.validation_runs(id) on delete set null,
  project_id uuid not null,
  centre_id uuid not null,
  kit_target_id uuid references public.kit_targets(id),
  collection_date date,
  sample_label text,
  target_name text not null,
  cq_value numeric,
  cq_sd numeric,
  normalized_cq numeric,
  copy_number numeric,
  copy_number_sd numeric,
  metric_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (upload_batch_id, project_id, centre_id)
    references public.upload_batches(id, project_id, centre_id) on delete cascade
);

create index if not exists idx_compiled_measurements_project_centre_date
  on public.compiled_measurements(project_id, centre_id, collection_date);
create index if not exists idx_compiled_measurements_project_target
  on public.compiled_measurements(project_id, target_name, collection_date);
create index if not exists idx_compiled_measurements_batch
  on public.compiled_measurements(upload_batch_id, project_id, centre_id);
create index if not exists idx_compiled_measurements_validation_run
  on public.compiled_measurements(validation_run_id);
create index if not exists idx_compiled_measurements_kit_target
  on public.compiled_measurements(kit_target_id);

-- ---------- updated_at triggers ----------
drop trigger if exists trg_upload_batches_updated_at on public.upload_batches;
create trigger trg_upload_batches_updated_at before update on public.upload_batches
for each row execute function public.set_updated_at();

-- ---------- RLS ----------
alter table public.upload_batches enable row level security;
alter table public.upload_files enable row level security;
alter table public.validation_runs enable row level security;
alter table public.validation_issues enable row level security;
alter table public.compiled_measurements enable row level security;

-- upload batches: centre users create and edit their own pending batches;
-- only project admins (and super admin) can approve or reject.
drop policy if exists "upload batches read" on public.upload_batches;
create policy "upload batches read"
on public.upload_batches
for select
to authenticated
using (private.can_access_centre(project_id, centre_id));

drop policy if exists "upload batches insert" on public.upload_batches;
create policy "upload batches insert"
on public.upload_batches
for insert
to authenticated
with check (
  private.can_manage_project(project_id)
  or (
    private.is_centre_member(project_id, centre_id)
    and uploaded_by = (select auth.uid())
    and approval_status = 'pending'
    and approved_by is null
    and approved_at is null
  )
);

drop policy if exists "upload batches update" on public.upload_batches;
create policy "upload batches update"
on public.upload_batches
for update
to authenticated
using (
  private.can_manage_project(project_id)
  or (
    private.is_centre_member(project_id, centre_id)
    and uploaded_by = (select auth.uid())
    and approval_status = 'pending'
  )
)
with check (
  private.can_manage_project(project_id)
  or (
    private.is_centre_member(project_id, centre_id)
    and uploaded_by = (select auth.uid())
    and approval_status = 'pending'
    and approved_by is null
    and approved_at is null
  )
);

drop policy if exists "upload batches delete" on public.upload_batches;
create policy "upload batches delete"
on public.upload_batches
for delete
to authenticated
using (
  private.can_manage_project(project_id)
  or (
    private.is_centre_member(project_id, centre_id)
    and uploaded_by = (select auth.uid())
    and approval_status = 'pending'
  )
);

-- upload files: writable by the batch uploader while the batch is pending.
drop policy if exists "upload files read" on public.upload_files;
create policy "upload files read"
on public.upload_files
for select
to authenticated
using (private.can_access_centre(project_id, centre_id));

drop policy if exists "upload files write" on public.upload_files;
create policy "upload files write"
on public.upload_files
for all
to authenticated
using (
  private.can_manage_project(project_id)
  or exists (
    select 1
    from public.upload_batches ub
    where ub.id = upload_batch_id
      and ub.uploaded_by = (select auth.uid())
      and ub.approval_status = 'pending'
      and private.is_centre_member(ub.project_id, ub.centre_id)
  )
)
with check (
  private.can_manage_project(project_id)
  or exists (
    select 1
    from public.upload_batches ub
    where ub.id = upload_batch_id
      and ub.uploaded_by = (select auth.uid())
      and ub.approval_status = 'pending'
      and private.is_centre_member(ub.project_id, ub.centre_id)
  )
);

-- Validation and compiled data are written by server jobs (service role) or by
-- project admins. Centre users can read their own centre's results.
drop policy if exists "validation runs read" on public.validation_runs;
create policy "validation runs read"
on public.validation_runs
for select
to authenticated
using (private.can_access_centre(project_id, centre_id));

drop policy if exists "validation runs manage" on public.validation_runs;
create policy "validation runs manage"
on public.validation_runs
for all
to authenticated
using (private.can_manage_project(project_id))
with check (private.can_manage_project(project_id));

drop policy if exists "validation issues read" on public.validation_issues;
create policy "validation issues read"
on public.validation_issues
for select
to authenticated
using (private.can_access_centre(project_id, centre_id));

drop policy if exists "validation issues manage" on public.validation_issues;
create policy "validation issues manage"
on public.validation_issues
for all
to authenticated
using (private.can_manage_project(project_id))
with check (private.can_manage_project(project_id));

drop policy if exists "compiled measurements read" on public.compiled_measurements;
create policy "compiled measurements read"
on public.compiled_measurements
for select
to authenticated
using (private.can_access_centre(project_id, centre_id));

drop policy if exists "compiled measurements manage" on public.compiled_measurements;
create policy "compiled measurements manage"
on public.compiled_measurements
for all
to authenticated
using (private.can_manage_project(project_id))
with check (private.can_manage_project(project_id));

-- ---------- Grants ----------
revoke all on
  public.upload_batches,
  public.upload_files,
  public.validation_runs,
  public.validation_issues,
  public.compiled_measurements
from anon, authenticated;

grant select, insert, update, delete
  on public.upload_batches,
     public.upload_files,
     public.validation_runs,
     public.validation_issues,
     public.compiled_measurements
to authenticated;

grant all on
  public.upload_batches,
  public.upload_files,
  public.validation_runs,
  public.validation_issues,
  public.compiled_measurements
to service_role;
