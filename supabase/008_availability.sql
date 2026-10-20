-- MediaHub platform, Phase 3b: availability per service, the way the NLAG team works today.
-- Additive. Apply after 007_scheduling.sql. Schedulers open an event for availability; members answer
-- Available or Not available for each service before anyone is scheduled. A missing answer means "not answered".
begin;

alter table public.events add column availability_open boolean not null default false;

create table public.service_availability(
 org_id uuid not null,
 service_id uuid not null,
 user_id uuid not null,
 status text not null check(status in ('available','not_available')),
 submitted_at timestamptz not null default now(),
 primary key(service_id,user_id),
 foreign key(org_id,service_id) references public.event_services(org_id,id) on delete cascade,
 foreign key(org_id,user_id) references public.org_members(org_id,user_id) on delete cascade
);
create index service_availability_org_idx on public.service_availability(org_id,user_id);
alter table public.service_availability enable row level security;
-- People read their own answers; anyone who schedules reads everyone's. Writes go through set_availability.
create policy availability_read on public.service_availability for select to authenticated using(
 user_id=(select auth.uid()) or public.has_permission(org_id,'schedule.manage') or public.leads_department(org_id,null));
grant select on public.service_availability to authenticated;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in ('scheduled','cancelled','declined','replacement_requested','replacement_taken','availability'));

-- Upcoming events that ask for availability, with my answers. Works for drafts without revealing their roster or plan.
create function public.availability_requests(p_org uuid) returns table(event_id uuid,title text,event_date date,campus_id uuid,service_id uuid,service_name text,starts_at time,sort_order int,status text)
 language sql stable security definer set search_path='' as $$
 select e.id,e.title,e.event_date,e.campus_id,s.id,s.name,s.starts_at,s.sort_order,a.status
 from public.events e join public.event_services s on s.event_id=e.id
 left join public.service_availability a on a.service_id=s.id and a.user_id=auth.uid()
 where e.org_id=p_org and public.is_org_member(p_org) and e.availability_open and e.status in ('draft','published') and e.event_date>=current_date
 order by e.event_date,s.sort_order;
$$;

create function public.set_availability(p_service uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
 declare s record;
 begin
 if p_status is null or p_status not in ('available','not_available') then raise exception 'Choose available or not available'; end if;
 select sv.org_id,e.availability_open,e.status,e.event_date into s from public.event_services sv join public.events e on e.id=sv.event_id where sv.id=p_service;
 if s.org_id is null or not public.is_org_member(s.org_id) then raise exception 'Service not found'; end if;
 if not s.availability_open or s.status not in ('draft','published') or s.event_date<current_date then raise exception 'This event is not asking for availability'; end if;
 if not exists(select 1 from public.organizations where id=s.org_id and status='active') then raise exception 'This organization is suspended'; end if;
 insert into public.service_availability(org_id,service_id,user_id,status) values(s.org_id,p_service,auth.uid(),p_status)
 on conflict(service_id,user_id) do update set status=excluded.status,submitted_at=now();
 end;
$$;

-- Opening availability tells every member who is trained for a position the event needs.
create function public.notify_availability_open() returns trigger language plpgsql security definer set search_path='' as $$
 begin
 if new.availability_open and not old.availability_open and new.status in ('draft','published') and new.event_date>=current_date then
  perform public.notify(array(select distinct mp.user_id from public.member_positions mp join public.event_needs n on n.position_id=mp.position_id and n.event_id=new.id),
   new.org_id,'availability',format('Are you available for %s?',new.title),to_char(new.event_date,'Dy DD Mon YYYY'),new.id);
 end if;
 return null;
 end;
$$;
create trigger notify_availability_open after update of availability_open on public.events for each row execute function public.notify_availability_open();

-- Service types can open availability automatically on every event they create.
alter table public.service_types add column ask_availability boolean not null default false;
create or replace function public.create_event(p_org uuid,p_event jsonb) returns uuid language plpgsql security definer set search_path='' as $$
 declare nid uuid;
 begin
 if not public.has_permission(p_org,'events.manage') then raise exception 'You do not have permission to manage events'; end if;
 if p_event is null or jsonb_typeof(p_event)<>'object' then raise exception 'Invalid event'; end if;
 if jsonb_array_length(coalesce(p_event->'services','[]'))>12 then raise exception 'An event can have at most 12 services'; end if;
 insert into public.events(org_id,title,event_date,notes,campus_id,service_type_id,created_by)
  values(p_org,trim(p_event->>'title'),(p_event->>'event_date')::date,coalesce(p_event->>'notes',''),
   nullif(p_event->>'campus_id','')::uuid,nullif(p_event->>'service_type_id','')::uuid,auth.uid()) returning id into nid;
 insert into public.event_services(org_id,event_id,name,starts_at,sort_order)
  select p_org,nid,coalesce(nullif(trim(s->>'name'),''),'Service'),nullif(s->>'starts_at','')::time,o::int
  from jsonb_array_elements(coalesce(p_event->'services','[]')) with ordinality x(s,o);
 insert into public.event_needs(org_id,event_id,position_id,quantity)
  select p_org,nid,(n->>'position_id')::uuid,(n->>'quantity')::int
  from jsonb_array_elements(coalesce(p_event->'needs','[]')) n where coalesce((n->>'quantity')::int,0)>0;
 -- Opened after the needs exist so the right people are told.
 if coalesce((p_event->>'availability_open')::boolean,false) then update public.events set availability_open=true where id=nid; end if;
 return nid;
 end;
$$;

create or replace function public.create_events_from_type(p_type uuid,p_from date,p_count int) returns int language plpgsql security definer set search_path='' as $$
 declare t public.service_types; d date; made int:=0;
 begin
 select * into t from public.service_types where id=p_type;
 if t.id is null or not public.has_permission(t.org_id,'events.manage') then raise exception 'You do not have permission to manage events'; end if;
 if t.weekday is null then raise exception 'Choose the day of the week this service happens'; end if;
 if p_from is null or p_count is null or p_count not between 1 and 26 then raise exception 'Choose between 1 and 26 weeks'; end if;
 d:=p_from+((t.weekday-extract(dow from p_from)::int+7)%7);
 for i in 1..p_count loop
  if not exists(select 1 from public.events where org_id=t.org_id and service_type_id=t.id and event_date=d) then
   perform public.create_event(t.org_id,jsonb_build_object('title',t.name,'event_date',d,'notes',t.notes,'campus_id',t.campus_id,'service_type_id',t.id,'availability_open',t.ask_availability,'services',t.services,
    'needs',(select coalesce(jsonb_agg(n),'[]') from jsonb_array_elements(t.needs) n where exists(select 1 from public.positions p where p.org_id=t.org_id and p.id=(n->>'position_id')::uuid))));
   made:=made+1;
  end if;
  d:=d+7;
 end loop;
 return made;
 end;
$$;

revoke execute on function public.notify_availability_open() from public,anon,authenticated;
revoke execute on function public.availability_requests(uuid),public.set_availability(uuid,text) from public,anon;
grant execute on function public.availability_requests(uuid),public.set_availability(uuid,text) to authenticated;
commit;
