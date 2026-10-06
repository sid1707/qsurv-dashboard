-- Centre workspace (/p/[code]/centre): uploads of qPCR runs.
--   * An upload is the instrument's results export (CSV) plus its native run
--     file. upload_files.file_kind gets a value for the export.
--   * Centre users start uploads only for an active centre.
--   * Centre users cannot move a batch through the pipeline themselves. The
--     server sets upload and processing status after it validates the stored
--     file with the service role; project admins approve or reject.

alter type public.file_kind add value if not exists 'results';

comment on column public.upload_files.file_kind is
  'results: the instrument results export (CSV) that is validated; runfile: the native run file (.eds, .pcrd ...); metadata: sample sheets.';

-- ---------- Start uploads only for an active centre ----------
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
    and exists (
      select 1 from public.centres c
      where c.id = upload_batches.centre_id
        and c.project_id = upload_batches.project_id
        and c.active
    )
  )
);

-- ---------- Pipeline columns are the server's ----------
create or replace function private.guard_centre_upload_batch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The service role (server processing) and project admins are not limited.
  -- Two steps: "or" does not promise to skip the second test, and the service
  -- role cannot run the private helpers.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if private.can_manage_project(new.project_id) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.upload_status <> 'draft' or new.processing_status is not null or new.submitted_at is not null then
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
     or new.compile_notes is distinct from old.compile_notes then
    raise exception 'Upload status is set by QSurv after validation.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_centre_upload_batch() from public, anon, authenticated;

drop trigger if exists trg_upload_batches_guard_centre on public.upload_batches;
create trigger trg_upload_batches_guard_centre
before insert or update on public.upload_batches
for each row execute function private.guard_centre_upload_batch();

-- Duplicate check: same file contents already submitted by the centre.
create index if not exists idx_upload_files_sha256
  on public.upload_files(project_id, centre_id, sha256)
  where sha256 is not null;
