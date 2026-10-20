-- Apply after 001_schema.sql in the same Supabase project's SQL editor.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('avatars','avatars',false,2097152,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
create policy avatar_insert_own on storage.objects for insert to authenticated with check(bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);
create policy avatar_read_authorized on storage.objects for select to authenticated using(bucket_id='avatars' and ((storage.foldername(name))[1]=auth.uid()::text or public.is_team_admin()));
create policy avatar_delete_own on storage.objects for delete to authenticated using(bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);
commit;
