create function public.day_service_ids(p_date date,p_campus text) returns setof text language sql stable set search_path='' as $$
select s.id from public.services s where s.campus_id=p_campus and s.enabled and
case when extract(dow from p_date)=0 then s.event_id is null
when exists(select 1 from public.services e where e.campus_id=p_campus and e.enabled and e.event_id is not null and e.service_date=p_date) then s.event_id is not null and s.service_date=p_date
else s.event_id is null end;
$$;
revoke all on function public.day_service_ids(date,text) from public,anon;
grant execute on function public.day_service_ids(date,text) to authenticated;

CREATE OR REPLACE FUNCTION public.save_calendar_event(p_id uuid, p_title text, p_date date, p_campus text, p_names text[], p_special boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare eid uuid:=p_id; i int; sid text; old_event record; base int;
begin
perform pg_advisory_xact_lock(823714);
if not public.is_team_admin() then raise exception 'Admin access required';end if;
if p_date is null or length(trim(p_title)) not between 1 and 160 or p_campus not in ('kompally','eden_square') or p_special is null or coalesce(cardinality(p_names),0) not between 0 and 12 or exists(select 1 from unnest(p_names) n where n is null or length(trim(n)) not between 1 and 80) then raise exception 'Enter event details and 0–12 service names';end if;
if eid is null then insert into public.calendar_events(title,event_date,campus_id,special,created_by) values(trim(p_title),p_date,p_campus,p_special,auth.uid()) returning id into eid;
else
select * into old_event from public.calendar_events where id=eid and not deleted for update;
if not found then raise exception 'Event not found';end if;
if (old_event.event_date<>p_date or old_event.campus_id<>p_campus or (select count(*) from public.services where event_id=eid and enabled)>cardinality(p_names)) and (exists(select 1 from public.schedules s join public.services v on v.id=s.service_id where v.event_id=eid) or exists(select 1 from public.availability a join public.services v on v.id=a.service_id where v.event_id=eid)) then raise exception 'This event has responses or schedules. Keep its date, campus and service count.';end if;
update public.calendar_events set title=trim(p_title),event_date=p_date,campus_id=p_campus,special=p_special where id=eid;
end if;
update public.services set enabled=false where event_id=eid;
select coalesce(max(sort_order),0) into base from public.services;
for i in 1..cardinality(p_names) loop
sid:='event_'||eid::text||'_'||i;
insert into public.services(id,name,sort_order,campus_id,event_id,service_date,enabled) values(sid,trim(p_names[i]),base+i,p_campus,eid,p_date,true)
on conflict(id) do update set name=excluded.name,campus_id=excluded.campus_id,service_date=excluded.service_date,enabled=true;
end loop;return eid;
end $function$;
CREATE OR REPLACE FUNCTION public.submit_campus_availability(p_date date, p_services text[], p_campus text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare affected uuid[];
begin
 perform pg_advisory_xact_lock(823714);
 if auth.uid() is null or not public.is_active_member() then raise exception 'An active account is required'; end if;
 if not exists(select 1 from public.profiles where id=auth.uid() and length(trim(full_name))>0 and length(trim(phone))>0) then raise exception 'Complete your profile first'; end if;
 if p_campus is null or p_campus not in ('kompally','eden_square') or p_date is null or p_services is null or array_position(p_services,null) is not null then raise exception 'Invalid campus, services or date'; end if;
 if exists(select 1 from unnest(p_services) chosen where not exists(select 1 from public.services where id=chosen and campus_id=p_campus and id in (select public.day_service_ids(p_date,p_campus)))) then raise exception 'Service does not belong to this campus'; end if;
 select array_agg(distinct s.id) into affected from public.schedules s join public.services svc on svc.id=s.service_id join public.assignments a on a.schedule_id=s.id where svc.campus_id=p_campus and svc.enabled and (svc.service_date is null or svc.service_date=p_date) and s.service_date=p_date and a.user_id=auth.uid() and not(s.service_id=any(p_services));
 update public.schedules set status='draft',revision=revision+1,updated_at=now() where id=any(affected);
 delete from public.assignments where user_id=auth.uid() and schedule_id=any(affected);
 insert into public.availability(user_id,service_date,service_id,status)
 select auth.uid(),p_date,id,case when id=any(p_services) then 'available' else 'not_available' end from public.services where campus_id=p_campus and id in (select public.day_service_ids(p_date,p_campus))
 on conflict(user_id,service_date,service_id) do update set status=excluded.status,submitted_at=now();
end;
$function$;

