begin;
alter table public.schedules add column not_needed_cameras text[] not null default '{}';
alter table public.schedules add constraint schedules_not_needed_cameras_check check(not_needed_cameras <@ array['cam_1','cam_2','cam_3','cam_4','cam_5','cam_6','cam_7','cam_8','cam_9','cam_10','cam_11','cam_12','cam_13','cam_14','cam_15','cam_16']::text[]);
create or replace function public.save_schedule(p_date date,p_service text,p_assignments jsonb,p_publish boolean,p_revision integer,p_camera_count integer) returns uuid language plpgsql security definer set search_path='' as $$
 declare sid uuid; rev int; entry record; uid uuid; needed text; skipped text[];
 begin
 perform pg_advisory_xact_lock(823714);
 if not public.is_team_admin() then raise exception 'Admin access required'; end if;
 if p_camera_count is null or p_camera_count<0 or p_camera_count>16 then raise exception 'Choose between 0 and 16 cameras'; end if;
 if p_date is null or p_service is null or p_publish is null or p_revision is null or p_assignments is null or jsonb_typeof(p_assignments)<>'object' then raise exception 'Invalid schedule'; end if;
 if not exists(select 1 from public.services where id=p_service) then raise exception 'Unknown service'; end if;
 select id,revision into sid,rev from public.schedules where service_date=p_date and service_id=p_service;
 if coalesce(rev,0)<>p_revision then raise exception 'Schedule changed since you opened it. Reload before saving.'; end if;
 if p_publish and (select count(*) from jsonb_object_keys(p_assignments))<>p_camera_count+2 then raise exception 'Fill all % positions before publishing',p_camera_count+2; end if;
 for entry in select * from jsonb_each_text(p_assignments) loop
 if not(entry.key in ('producer','ccu') or entry.key in (select 'cam_'||n::text from generate_series(1,p_camera_count) n)) or entry.value is null then raise exception 'Invalid assignment position'; end if;
 if entry.value='not_needed' then if entry.key not like 'cam_%' then raise exception 'Only cameras can be marked Not needed'; end if; continue; end if;
 uid:=entry.value::uuid; needed:=case when entry.key like 'cam_%' then 'camera' else entry.key end;
 if not exists(select 1 from public.profiles p join public.availability a on a.user_id=p.id where p.id=uid and p.active and needed=any(p.skills) and a.service_date=p_date and a.service_id=p_service and a.status='available') then raise exception 'Member is unavailable, inactive, or ineligible for %',entry.key; end if;
 end loop;
 select coalesce(array_agg(key),'{}'::text[]) into skipped from jsonb_each_text(p_assignments) where value='not_needed';
 if sid is null then
 insert into public.schedules(service_date,service_id,camera_count,not_needed_cameras,status,updated_by) values(p_date,p_service,p_camera_count,skipped,case when p_publish then 'published' else 'draft' end,auth.uid()) returning id into sid;
 else
 update public.schedules set camera_count=p_camera_count,not_needed_cameras=skipped,status=case when p_publish then 'published' else 'draft' end,revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=sid;
 end if;
 delete from public.assignments where schedule_id=sid;
 insert into public.assignments(schedule_id,position,user_id) select sid,key,value::uuid from jsonb_each_text(p_assignments) where value<>'not_needed';
 return sid;
 end;
$$;

revoke execute on function public.save_schedule(date,text,jsonb,boolean,integer,integer) from public,anon;
grant execute on function public.save_schedule(date,text,jsonb,boolean,integer,integer) to authenticated;
create or replace function public.published_schedule(p_date date) returns table(service_id text,"position" text,user_id uuid,full_name text) language sql stable security definer set search_path='' as $$
 select s.service_id,a.position,p.id,p.full_name from public.schedules s join public.assignments a on a.schedule_id=s.id join public.profiles p on p.id=a.user_id where s.service_date=p_date and s.status='published' and public.is_active_member()
 union all
 select s.service_id,slot,null::uuid,'Not needed'::text from public.schedules s cross join lateral unnest(s.not_needed_cameras) slot where s.service_date=p_date and s.status='published' and public.is_active_member();
$$;
revoke execute on function public.published_schedule(date) from public,anon;
grant execute on function public.published_schedule(date) to authenticated;
commit;