alter table public.calendar_events add column campus_id text not null default 'kompally' check(campus_id in ('kompally','eden_square')), add column special boolean not null default true, add column deleted boolean not null default false;
alter table public.services add column event_id uuid references public.calendar_events(id), add column service_date date, add column enabled boolean not null default true;
create function public.save_calendar_event(p_id uuid,p_title text,p_date date,p_campus text,p_names text[],p_special boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare eid uuid:=p_id; i int; sid text; old_event record; base int;
begin
perform pg_advisory_xact_lock(823714);
if not public.is_team_admin() then raise exception 'Admin access required';end if;
if p_date is null or length(trim(p_title)) not between 1 and 160 or p_campus not in ('kompally','eden_square') or p_special is null or coalesce(cardinality(p_names),0) not between 1 and 12 or exists(select 1 from unnest(p_names) n where n is null or length(trim(n)) not between 1 and 80) then raise exception 'Enter event details and 1–12 service names';end if;
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
end $$;
create function public.delete_calendar_event(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
perform pg_advisory_xact_lock(823714);
if not public.is_team_admin() then raise exception 'Admin access required';end if;
if exists(select 1 from public.schedules s join public.services v on v.id=s.service_id where v.event_id=p_id and s.status='published') then raise exception 'Published schedules exist. This event cannot be deleted.';end if;
update public.calendar_events set deleted=true where id=p_id;
update public.services set enabled=false where event_id=p_id;
end $$;
create function service_team_private.check_event_schedule_date() returns trigger language plpgsql set search_path='' as $$
begin
if exists(select 1 from public.services where id=new.service_id and event_id is not null and (not enabled or service_date<>new.service_date)) then raise exception 'Event service is unavailable on this date';end if;return new;
end $$;
create trigger check_event_schedule_date before insert or update on public.schedules for each row execute function service_team_private.check_event_schedule_date();
revoke all on function public.save_calendar_event(uuid,text,date,text,text[],boolean),public.delete_calendar_event(uuid) from public,anon;
grant execute on function public.save_calendar_event(uuid,text,date,text,text[],boolean),public.delete_calendar_event(uuid) to authenticated;
revoke all on function service_team_private.check_event_schedule_date() from public,anon,authenticated;
create function public.schedule_history() returns table(service_date date,service_id text,service_name text,campus_id text,user_id uuid,full_name text,"position" text) language sql stable security definer set search_path='' as $$
select s.service_date,s.service_id,v.name,v.campus_id,a.user_id,p.full_name,a.position from public.schedules s join public.services v on v.id=s.service_id left join public.assignments a on a.schedule_id=s.id left join public.profiles p on p.id=a.user_id where public.is_active_member() and s.status='published' and s.service_date<(now() at time zone 'Asia/Kolkata')::date and (public.is_team_admin() or a.user_id=auth.uid()) order by s.service_date desc,v.sort_order;
$$;
revoke all on function public.schedule_history() from public,anon;
grant execute on function public.schedule_history() to authenticated;
