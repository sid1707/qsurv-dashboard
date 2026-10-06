-- QSurv portal: one private bucket for all project files.
-- Object paths are <project_code>/<centre_id>/<anything>.

insert into storage.buckets (id, name, public)
values ('qsurv-files', 'qsurv-files', false)
on conflict (id) do nothing;

-- Super admin, the project's admin, or a user of that centre.
create or replace function private.can_access_storage_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects p
    join public.centres c on c.project_id = p.id
    where p.code = split_part(p_name, '/', 1)
      and c.id::text = split_part(p_name, '/', 2)
      and private.can_access_centre(p.id, c.id)
  );
$$;

-- Super admin or the project's admin.
create or replace function private.can_manage_storage_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects p
    join public.centres c on c.project_id = p.id
    where p.code = split_part(p_name, '/', 1)
      and c.id::text = split_part(p_name, '/', 2)
      and private.can_manage_project(p.id)
  );
$$;

revoke all on function
  private.can_access_storage_object(text),
  private.can_manage_storage_object(text)
from public, anon;
grant execute on function
  private.can_access_storage_object(text),
  private.can_manage_storage_object(text)
to authenticated;

drop policy if exists "qsurv files read" on storage.objects;
create policy "qsurv files read"
on storage.objects
for select
to authenticated
using (bucket_id = 'qsurv-files' and private.can_access_storage_object(name));

drop policy if exists "qsurv files insert" on storage.objects;
create policy "qsurv files insert"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'qsurv-files' and private.can_access_storage_object(name));

-- Overwrites and deletes are for project admins; centre users upload new objects.
drop policy if exists "qsurv files update" on storage.objects;
create policy "qsurv files update"
on storage.objects
for update
to authenticated
using (bucket_id = 'qsurv-files' and private.can_manage_storage_object(name))
with check (bucket_id = 'qsurv-files' and private.can_manage_storage_object(name));

drop policy if exists "qsurv files delete" on storage.objects;
create policy "qsurv files delete"
on storage.objects
for delete
to authenticated
using (bucket_id = 'qsurv-files' and private.can_manage_storage_object(name));
