alter table public.schedules add column camera_count integer not null default 8 check(camera_count between 0 and 16);
alter table public.assignments drop constraint assignments_position_check;
alter table public.assignments add constraint assignments_position_check check(position in ('producer','ccu') or position ~ '^cam_([1-9]|1[0-6])$');
create function public.save_schedule(p_date date,p_service text,p_assignments jsonb,p_publish boolean,p_revision integer,p_camera_count integer) returns uuid language plpgsql security definer set search_path='' as $$
 declare sid uuid; rev int; entry record; uid uuid; needed text;
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
 uid:=entry.value::uuid; needed:=case when entry.key like 'cam_%' then 'camera' else entry.key end;
 if not exists(select 1 from public.profiles p join public.availability a on a.user_id=p.id where p.id=uid and p.active and needed=any(p.skills) and a.service_date=p_date and a.service_id=p_service and a.status='available') then raise exception 'Member is unavailable, inactive, or ineligible for %',entry.key; end if;
 end loop;
 if sid is null then
 insert into public.schedules(service_date,service_id,camera_count,status,updated_by) values(p_date,p_service,p_camera_count,case when p_publish then 'published' else 'draft' end,auth.uid()) returning id into sid;
 else
 update public.schedules set camera_count=p_camera_count,status=case when p_publish then 'published' else 'draft' end,revision=revision+1,updated_at=now(),updated_by=auth.uid() where id=sid;
 end if;
 delete from public.assignments where schedule_id=sid;
 insert into public.assignments(schedule_id,position,user_id) select sid,key,value::uuid from jsonb_each_text(p_assignments);
 return sid;
 end;
$$;

revoke execute on function public.save_schedule(date,text,jsonb,boolean,integer,integer) from public,anon;
grant execute on function public.save_schedule(date,text,jsonb,boolean,integer,integer) to authenticated;
-- Preserve old clients without allowing them to reset an existing camera count.
create or replace function public.save_schedule(p_date date,p_service text,p_assignments jsonb,p_publish boolean,p_revision integer) returns uuid language sql security invoker set search_path='' as $$
select public.save_schedule(p_date,p_service,p_assignments,p_publish,p_revision,coalesce((select camera_count from public.schedules where service_date=p_date and service_id=p_service),8));
$$;
