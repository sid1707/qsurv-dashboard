-- QSurv portal: centre users cannot swap a file after it has been validated.
--
-- upload_files stayed writable by the uploader until the upload was approved
-- or rejected. After submit (validated, waiting for the admin), they could
-- store a new object in their centre folder and point storage_path at it, and
-- approval would then compile a file nobody validated. Centre users now write
-- upload_files only while the batch is a draft, and only for objects in that
-- upload's own folder (<project_code>/<centre_id>/<upload_id>/<kind>/<file>),
-- as lib/upload/path.ts builds them. Project admins are unchanged.

create or replace function private.is_own_draft_upload_file(
  p_upload_batch_id uuid,
  p_file_kind public.file_kind,
  p_storage_bucket text,
  p_storage_path text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.upload_batches ub
    join public.projects p on p.id = ub.project_id
    where ub.id = p_upload_batch_id
      and ub.uploaded_by = (select auth.uid())
      and ub.upload_status = 'draft'
      and ub.approval_status = 'pending'
      and private.is_centre_member(ub.project_id, ub.centre_id)
      and p_storage_bucket = 'qsurv-files'
      and starts_with(p_storage_path, p.code || '/' || ub.centre_id || '/' || ub.id || '/' || p_file_kind || '/')
      and strpos(substr(p_storage_path, char_length(p.code || '/' || ub.centre_id || '/' || ub.id || '/' || p_file_kind || '/') + 1), '/') = 0
  );
$$;

revoke all on function private.is_own_draft_upload_file(uuid, public.file_kind, text, text) from public, anon;
grant execute on function private.is_own_draft_upload_file(uuid, public.file_kind, text, text) to authenticated;

drop policy if exists "upload files write" on public.upload_files;
create policy "upload files write"
on public.upload_files
for all
to authenticated
using (
  private.can_manage_project(project_id)
  or private.is_own_draft_upload_file(upload_batch_id, file_kind, storage_bucket, storage_path)
)
with check (
  private.can_manage_project(project_id)
  or private.is_own_draft_upload_file(upload_batch_id, file_kind, storage_bucket, storage_path)
);
