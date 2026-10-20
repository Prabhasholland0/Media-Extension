-- MediaHub platform, Phase 3b: copy the NLAG Service Team into the platform.
-- Apply after 008_availability.sql. This only CREATES the import function; nothing is copied until the database owner runs:
--   select * from platform_private.import_nlag('<owner profile id>','New Life Assembly of God');
-- in the Supabase SQL editor (after a backup). NLAG tables are only read, never changed, so the NLAG app keeps working.
-- Re-running is safe: it adds members, skills, schedules and availability that are new since the last run and leaves
-- everything already copied alone. The result compares NLAG and platform counts.
begin;

create table platform_private.nlag_map(
 kind text not null,
 legacy_key text not null,
 platform_id uuid not null,
 imported_at timestamptz not null default now(),
 primary key(kind,legacy_key)
);

create function platform_private.import_nlag(p_owner uuid,p_name text) returns table(item text,nlag bigint,platform bigint,note text)
 language plpgsql set search_path='' as $$
 declare
  org uuid; team uuid; pos_producer uuid; pos_ccu uuid; pos_camera uuid; camp uuid; ev uuid; svc uuid;
  d record; needed int[]; cams int; skipped bigint:=0; c record;
 begin
 if not exists(select 1 from public.profiles where id=p_owner and is_admin and active and legacy_team) then
  raise exception 'The owner must be an active NLAG admin';
 end if;

 -- Organization, campuses, the Video department and its positions.
 select platform_id into org from platform_private.nlag_map where kind='org' and legacy_key='nlag';
 if org is null then
  insert into public.organizations(name,created_by,time_zone,onboarded_at) values(coalesce(nullif(trim(p_name),''),'NLAG'),p_owner,'Asia/Kolkata',now()) returning id into org;
  insert into public.org_members(org_id,user_id,role) values(org,p_owner,'owner');
  insert into platform_private.nlag_map values('org','nlag',org);
 end if;
 for c in select * from (values('kompally','Kompally',1),('eden_square','Eden Square',2)) v(k,n,o) loop
  if not exists(select 1 from platform_private.nlag_map where kind='campus' and legacy_key=c.k) then
   insert into public.campuses(org_id,name,sort_order) values(org,c.n,c.o) returning id into camp;
   insert into platform_private.nlag_map values('campus',c.k,camp);
  end if;
 end loop;
 select platform_id into team from platform_private.nlag_map where kind='team' and legacy_key='video';
 if team is null then
  insert into public.teams(org_id,name,description,sort_order) values(org,'Video','Producer, CCU and cameras for every service.',1) returning id into team;
  insert into platform_private.nlag_map values('team','video',team);
 end if;
 for c in select * from (values('producer','Producer',1),('ccu','CCU',2),('camera','Camera',3)) v(k,n,o) loop
  if not exists(select 1 from platform_private.nlag_map where kind='position' and legacy_key=c.k) then
   insert into public.positions(org_id,team_id,name,sort_order) values(org,team,c.n,c.o) returning id into svc;
   insert into platform_private.nlag_map values('position',c.k,svc);
  end if;
 end loop;
 select platform_id into pos_producer from platform_private.nlag_map where kind='position' and legacy_key='producer';
 select platform_id into pos_ccu from platform_private.nlag_map where kind='position' and legacy_key='ccu';
 select platform_id into pos_camera from platform_private.nlag_map where kind='position' and legacy_key='camera';

 -- Active NLAG members join; NLAG admins become Church admins. Skills become positions.
 insert into public.org_members(org_id,user_id,role)
  select org,p.id,case when p.is_admin then 'admin' else 'member' end from public.profiles p where p.legacy_team and p.active
  on conflict(org_id,user_id) do nothing;
 insert into public.member_positions(org_id,user_id,position_id)
  select org,p.id,case k when 'producer' then pos_producer when 'ccu' then pos_ccu else pos_camera end
  from public.profiles p cross join unnest(p.skills) k
  where exists(select 1 from public.org_members m where m.org_id=org and m.user_id=p.id)
  on conflict do nothing;

 -- One platform event per NLAG service and date: every schedule, plus future dates people already answered.
 for d in
  select x.service_date,x.service_id,sv.name,sv.campus_id,sc.id schedule_id,sc.status,coalesce(sc.camera_count,8) camera_count,coalesce(sc.not_needed_cameras,'{}') not_needed
  from (select service_date,service_id from public.schedules union select service_date,service_id from public.availability where service_date>=current_date) x
  join public.services sv on sv.id=x.service_id
  left join public.schedules sc on sc.service_date=x.service_date and sc.service_id=x.service_id
  where not exists(select 1 from platform_private.nlag_map m where m.kind='service_day' and m.legacy_key=x.service_date||'|'||x.service_id)
  order by x.service_date,sv.sort_order
 loop
  select platform_id into camp from platform_private.nlag_map where kind='campus' and legacy_key=d.campus_id;
  -- Cameras in use, in order; "Not needed" cameras are left out so camera k maps to the next free Camera seat.
  select coalesce(array_agg(k order by k),'{}') into needed from generate_series(1,d.camera_count) k where not ('cam_'||k)=any(d.not_needed);
  cams:=coalesce(array_length(needed,1),0);
  insert into public.events(org_id,title,event_date,notes,campus_id,status,created_by,availability_open)
   values(org,d.name,d.service_date,'Imported from NLAG MediaHub.',camp,'draft',p_owner,d.service_date>=current_date and coalesce(d.status,'draft')='draft') returning id into ev;
  insert into public.event_services(org_id,event_id,name,sort_order) values(org,ev,d.name,1) returning id into svc;
  insert into public.event_needs(org_id,event_id,position_id,quantity) values(org,ev,pos_producer,1),(org,ev,pos_ccu,1);
  if cams>0 then insert into public.event_needs(org_id,event_id,position_id,quantity) values(org,ev,pos_camera,cams); end if;
  if d.schedule_id is not null then
   insert into public.plan_assignments(org_id,service_id,position_id,slot,user_id,status,responded_at)
    select org,svc,case when a.position='producer' then pos_producer when a.position='ccu' then pos_ccu else pos_camera end,
     case when a.position in ('producer','ccu') then 1 else array_position(needed,substr(a.position,5)::int) end,
     a.user_id,case when d.status='published' then 'accepted' else 'pending' end,case when d.status='published' then now() end
    from public.assignments a
    where a.schedule_id=d.schedule_id and exists(select 1 from public.org_members m where m.org_id=org and m.user_id=a.user_id)
     and (a.position in ('producer','ccu') or array_position(needed,substr(a.position,5)::int) is not null);
  end if;
  insert into public.service_availability(org_id,service_id,user_id,status,submitted_at)
   select org,svc,av.user_id,av.status,av.submitted_at from public.availability av
   where av.service_date=d.service_date and av.service_id=d.service_id and exists(select 1 from public.org_members m where m.org_id=org and m.user_id=av.user_id);
  -- Status last, so imported history does not send "you have been scheduled" notifications.
  -- Availability was opened on insert, so nobody is asked again for dates they already answered in NLAG.
  if d.status='published' then update public.events set status='published' where id=ev; end if;
  insert into platform_private.nlag_map values('service_day',d.service_date||'|'||d.service_id,ev);
 end loop;

 -- Report: what NLAG has next to what the platform now holds for it.
 return query select 'Active members',(select count(*) from public.profiles where legacy_team and active),(select count(*) from public.org_members where org_id=org),'Platform also counts the owner; inactive NLAG accounts are not copied.'::text;
 return query select 'Skills',(select count(*) from public.profiles p cross join unnest(p.skills) where p.legacy_team and p.active),(select count(*) from public.member_positions where org_id=org),''::text;
 return query select 'Service dates',(select count(*) from (select service_date,service_id from public.schedules union select service_date,service_id from public.availability where service_date>=current_date) x),
  (select count(*) from platform_private.nlag_map where kind='service_day'),''::text;
 select count(*) into skipped from public.assignments a where not exists(select 1 from public.org_members m where m.org_id=org and m.user_id=a.user_id);
 return query select 'Assignments',(select count(*) from public.assignments),(select count(*) from public.plan_assignments where org_id=org),
  format('%s belong to inactive accounts and were not copied; assignments on "Not needed" cameras are not copied either.',skipped);
 return query select 'Availability answers',(select count(*) from public.availability a join platform_private.nlag_map m on m.kind='service_day' and m.legacy_key=a.service_date||'|'||a.service_id),
  (select count(*) from public.service_availability where org_id=org),'Inactive accounts are not copied.'::text;
 end;
$$;
revoke all on function platform_private.import_nlag(uuid,text) from public,anon,authenticated;
commit;
