-- MediaHub platform, Phase 3a: universal scheduling.
-- Additive. Apply after 006_tenant_core.sql. Adds event cancel/complete states, an atomic create_event,
-- reusable service types with weekly scheduling, replacement requests, and in-app notifications.
-- Email delivery is not part of this migration (no SMTP provider is configured yet).
begin;

-- ---------- event lifecycle ----------
alter table public.events drop constraint events_status_check;
alter table public.events add constraint events_status_check check(status in ('draft','published','cancelled','completed'));
-- Members see every event that has left draft, including cancelled ones (so they know).
create or replace function public.can_see_event(p_org uuid,p_event uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.has_permission(p_org,'events.manage') or public.has_permission(p_org,'schedule.manage') or public.leads_department(p_org,null)
  or (public.is_org_member(p_org) and exists(select 1 from public.events where id=p_event and org_id=p_org and status<>'draft'));
$$;

-- ---------- service types ----------
-- A reusable template: services with start times and how many people each position needs.
create table public.service_types(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references public.organizations(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 80),
 campus_id uuid,
 weekday smallint check(weekday between 0 and 6),
 services jsonb not null default '[]' check(jsonb_typeof(services)='array' and jsonb_array_length(services)<=12),
 needs jsonb not null default '[]' check(jsonb_typeof(needs)='array' and jsonb_array_length(needs)<=200),
 notes text not null default '' check(length(notes)<=2000),
 archived_at timestamptz,
 created_at timestamptz not null default now(),
 unique(org_id,id),
 foreign key(org_id,campus_id) references public.campuses(org_id,id) on delete set null (campus_id)
);
create index service_types_org_idx on public.service_types(org_id);
alter table public.service_types enable row level security;
create policy service_types_read on public.service_types for select to authenticated using(public.is_org_member(org_id));
create policy service_types_write on public.service_types for all to authenticated using(public.has_permission(org_id,'events.manage')) with check(public.has_permission(org_id,'events.manage'));
grant select,insert,update,delete on public.service_types to authenticated;
create trigger audit_service_types after insert or update or delete on public.service_types for each row execute function public.audit_row();

alter table public.events add column service_type_id uuid;
alter table public.events add constraint events_service_type_fkey foreign key(org_id,service_type_id) references public.service_types(org_id,id) on delete set null (service_type_id);
create index events_service_type_idx on public.events(org_id,service_type_id,event_date);

-- One transaction for the event, its services and its needs (replaces three client inserts).
create function public.create_event(p_org uuid,p_event jsonb) returns uuid language plpgsql security definer set search_path='' as $$
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
 return nid;
 end;
$$;

-- Creates weekly events from a service type, skipping dates that already have one.
create function public.create_events_from_type(p_type uuid,p_from date,p_count int) returns int language plpgsql security definer set search_path='' as $$
 declare t public.service_types; d date; made int:=0;
 begin
 select * into t from public.service_types where id=p_type;
 if t.id is null or not public.has_permission(t.org_id,'events.manage') then raise exception 'You do not have permission to manage events'; end if;
 if t.weekday is null then raise exception 'Choose the day of the week this service happens'; end if;
 if p_from is null or p_count is null or p_count not between 1 and 26 then raise exception 'Choose between 1 and 26 weeks'; end if;
 d:=p_from+((t.weekday-extract(dow from p_from)::int+7)%7);
 for i in 1..p_count loop
  if not exists(select 1 from public.events where org_id=t.org_id and service_type_id=t.id and event_date=d) then
   perform public.create_event(t.org_id,jsonb_build_object('title',t.name,'event_date',d,'notes',t.notes,'campus_id',t.campus_id,'service_type_id',t.id,'services',t.services,
    'needs',(select coalesce(jsonb_agg(n),'[]') from jsonb_array_elements(t.needs) n where exists(select 1 from public.positions p where p.org_id=t.org_id and p.id=(n->>'position_id')::uuid))));
   made:=made+1;
  end if;
  d:=d+7;
 end loop;
 return made;
 end;
$$;

-- ---------- notifications (in-app) ----------
create table public.notifications(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 org_id uuid not null references public.organizations(id) on delete cascade,
 kind text not null check(kind in ('scheduled','cancelled','declined','replacement_requested','replacement_taken')),
 title text not null,
 body text not null default '',
 event_id uuid references public.events(id) on delete set null,
 created_at timestamptz not null default now(),
 read_at timestamptz
);
create index notifications_user_idx on public.notifications(user_id,created_at desc);
alter table public.notifications enable row level security;
-- Only the recipient reads; rows are written by the functions below, never by clients.
create policy notifications_read on public.notifications for select to authenticated using(user_id=(select auth.uid()));
grant select on public.notifications to authenticated;

create function public.mark_notifications_read(p_ids uuid[]) returns void language sql security definer set search_path='' as $$
 update public.notifications set read_at=now() where user_id=auth.uid() and read_at is null and (p_ids is null or id=any(p_ids));
$$;

-- Sends one notification to each current member listed, never to the person acting.
create function public.notify(p_users uuid[],p_org uuid,p_kind text,p_title text,p_body text,p_event uuid) returns void language sql security definer set search_path='' as $$
 insert into public.notifications(user_id,org_id,kind,title,body,event_id)
 select distinct u,p_org,p_kind,p_title,coalesce(p_body,''),p_event from unnest(p_users) u
 where u is not null and u is distinct from auth.uid() and exists(select 1 from public.org_members m where m.org_id=p_org and m.user_id=u);
$$;
-- Everyone who can fill a position: schedulers, the owner, and that department's leaders and coordinators.
create function public.schedulers_for(p_org uuid,p_position uuid) returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(distinct m.user_id),'{}') from public.org_members m left join public.org_roles r on r.org_id=m.org_id and r.key=m.role
 where m.org_id=p_org and (m.role='owner' or 'schedule.manage'=any(coalesce(r.permissions,'{}'))
  or exists(select 1 from public.department_members d join public.positions p on p.org_id=d.org_id and p.team_id=d.team_id
   where d.org_id=p_org and d.user_id=m.user_id and d.dept_role in ('leader','coordinator') and p.id=p_position));
$$;
create function public.assignment_context(p_assignment uuid) returns table(org_id uuid,event_id uuid,event_status text,event_date date,service_id uuid,label text) language sql stable security definer set search_path='' as $$
 select e.org_id,e.id,e.status,e.event_date,s.id,format('%s · %s, %s · %s',p.name,e.title,to_char(e.event_date,'Dy DD Mon'),s.name)
 from public.plan_assignments a join public.event_services s on s.id=a.service_id join public.events e on e.id=s.event_id join public.positions p on p.id=a.position_id
 where a.id=p_assignment;
$$;

create function public.notify_new_assignment() returns trigger language plpgsql security definer set search_path='' as $$
 declare c record;
 begin
 select * into c from public.assignment_context(new.id);
 if c.event_status='published' then perform public.notify(array[new.user_id],c.org_id,'scheduled','You have been scheduled',c.label,c.event_id); end if;
 return null;
 end;
$$;
create trigger notify_new_assignment after insert on public.plan_assignments for each row execute function public.notify_new_assignment();

create function public.notify_event_status() returns trigger language plpgsql security definer set search_path='' as $$
 declare a record; c record;
 begin
 if new.status='published' and old.status='draft' then
  for a in select pa.id,pa.user_id from public.plan_assignments pa join public.event_services s on s.id=pa.service_id where s.event_id=new.id and pa.status='pending' loop
   select * into c from public.assignment_context(a.id);
   perform public.notify(array[a.user_id],new.org_id,'scheduled','You have been scheduled',c.label,new.id);
  end loop;
 elsif new.status='cancelled' and old.status<>'cancelled' then
  perform public.notify(array(select pa.user_id from public.plan_assignments pa join public.event_services s on s.id=pa.service_id where s.event_id=new.id and pa.status<>'declined'),
   new.org_id,'cancelled',format('%s is cancelled',new.title),to_char(new.event_date,'Dy DD Mon YYYY'),new.id);
 end if;
 return null;
 end;
$$;
create trigger notify_event_status after update of status on public.events for each row execute function public.notify_event_status();

-- People who leave an organization stop seeing its notifications.
create function public.clear_member_notifications() returns trigger language plpgsql security definer set search_path='' as $$
 begin delete from public.notifications where org_id=old.org_id and user_id=old.user_id; return null; end;
$$;
create trigger clear_member_notifications after delete on public.org_members for each row execute function public.clear_member_notifications();

-- ---------- responses and replacements ----------
alter table public.plan_assignments add column replacement_requested_at timestamptz;
alter table public.plan_assignments add column replacement_note text not null default '' check(length(replacement_note)<=200);

create or replace function public.respond_assignment(p_assignment uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
 declare a public.plan_assignments; c record;
 begin
 if p_status is null or p_status not in ('accepted','declined') then raise exception 'Choose accept or decline'; end if;
 select * into a from public.plan_assignments where id=p_assignment and user_id=auth.uid();
 if a.id is null then raise exception 'Assignment not found'; end if;
 select * into c from public.assignment_context(a.id);
 if c.event_status in ('cancelled','completed') then raise exception 'This event is %',c.event_status; end if;
 if not exists(select 1 from public.organizations where id=a.org_id and status='active') then raise exception 'This organization is suspended'; end if;
 update public.plan_assignments set status=p_status,responded_at=now(),replacement_requested_at=null,replacement_note='' where id=a.id;
 if p_status='declined' and a.status<>'declined' and c.event_status='published' then
  perform public.notify(public.schedulers_for(a.org_id,a.position_id),a.org_id,'declined',
   format('%s declined',(select coalesce(nullif(full_name,''),'Someone') from public.profiles where id=a.user_id)),c.label,c.event_id);
 end if;
 end;
$$;

-- Asks for someone to take my spot; schedulers and every free, trained member hear about it.
create function public.request_replacement(p_assignment uuid,p_note text) returns void language plpgsql security definer set search_path='' as $$
 declare a public.plan_assignments; c record; who text;
 begin
 select * into a from public.plan_assignments where id=p_assignment and user_id=auth.uid();
 if a.id is null then raise exception 'Assignment not found'; end if;
 select * into c from public.assignment_context(a.id);
 if c.event_status<>'published' or c.event_date<current_date then raise exception 'You can ask for a replacement only for an upcoming published event'; end if;
 if not exists(select 1 from public.organizations where id=a.org_id and status='active') then raise exception 'This organization is suspended'; end if;
 update public.plan_assignments set replacement_requested_at=now(),replacement_note=left(trim(coalesce(p_note,'')),200) where id=a.id;
 select coalesce(nullif(full_name,''),'Someone') into who from public.profiles where id=a.user_id;
 perform public.notify(public.schedulers_for(a.org_id,a.position_id)||array(
   select mp.user_id from public.member_positions mp where mp.org_id=a.org_id and mp.position_id=a.position_id
   and not exists(select 1 from public.plan_assignments x where x.service_id=a.service_id and x.user_id=mp.user_id)
   and not exists(select 1 from public.blockouts b where b.user_id=mp.user_id and b.day=c.event_date)),
  a.org_id,'replacement_requested',format('%s needs a replacement',who),c.label,c.event_id);
 end;
$$;
create function public.cancel_replacement(p_assignment uuid) returns void language plpgsql security definer set search_path='' as $$
 begin
 update public.plan_assignments set replacement_requested_at=null,replacement_note='' where id=p_assignment and user_id=auth.uid();
 if not found then raise exception 'Assignment not found'; end if;
 end;
$$;
-- A trained member who is free takes an open spot; it becomes theirs, confirmed.
create function public.take_replacement(p_assignment uuid) returns void language plpgsql security definer set search_path='' as $$
 declare a public.plan_assignments; c record; me uuid:=auth.uid(); who text;
 begin
 select * into a from public.plan_assignments where id=p_assignment for update;
 if a.id is null or a.replacement_requested_at is null then raise exception 'This spot is no longer open'; end if;
 select * into c from public.assignment_context(a.id);
 if c.event_status<>'published' or c.event_date<current_date then raise exception 'This spot is no longer open'; end if;
 if a.user_id=me then raise exception 'This is already your spot'; end if;
 if not exists(select 1 from public.organizations where id=a.org_id and status='active') then raise exception 'This organization is suspended'; end if;
 if not exists(select 1 from public.member_positions where org_id=a.org_id and user_id=me and position_id=a.position_id) then raise exception 'You are not set up for this position'; end if;
 if exists(select 1 from public.plan_assignments where service_id=a.service_id and user_id=me) then raise exception 'You are already serving in this service'; end if;
 update public.plan_assignments set user_id=me,status='accepted',responded_at=now(),replacement_requested_at=null,replacement_note='' where id=a.id;
 select coalesce(nullif(full_name,''),'Someone') into who from public.profiles where id=me;
 perform public.notify(array[a.user_id],a.org_id,'replacement_taken','Your spot is covered',format('%s took %s',who,c.label),c.event_id);
 perform public.notify(array(select unnest(public.schedulers_for(a.org_id,a.position_id)) except select a.user_id),a.org_id,'replacement_taken',
  format('%s covered a spot',who),c.label,c.event_id);
 end;
$$;

-- Duplicates keep the service type link so weekly scheduling sees them.
create or replace function public.duplicate_event(p_event uuid,p_date date) returns uuid language plpgsql security definer set search_path='' as $$
 declare src public.events; nid uuid;
 begin
 select * into src from public.events where id=p_event;
 if src.id is null or not public.has_permission(src.org_id,'events.manage') then raise exception 'You do not have permission to manage events'; end if;
 if p_date is null then raise exception 'Choose a date'; end if;
 insert into public.events(org_id,title,event_date,notes,campus_id,service_type_id,created_by) values(src.org_id,src.title,p_date,src.notes,src.campus_id,src.service_type_id,auth.uid()) returning id into nid;
 insert into public.event_services(org_id,event_id,name,starts_at,sort_order) select org_id,nid,name,starts_at,sort_order from public.event_services where event_id=p_event;
 insert into public.event_needs(org_id,event_id,position_id,quantity) select org_id,nid,position_id,quantity from public.event_needs where event_id=p_event;
 insert into public.plan_items(org_id,event_id,title,kind,duration_minutes,notes,sort_order) select org_id,nid,title,kind,duration_minutes,notes,sort_order from public.plan_items where event_id=p_event;
 return nid;
 end;
$$;

-- ---------- function access ----------
revoke execute on function public.notify(uuid[],uuid,text,text,text,uuid),public.schedulers_for(uuid,uuid),public.assignment_context(uuid),
 public.notify_new_assignment(),public.notify_event_status(),public.clear_member_notifications() from public,anon,authenticated;
revoke execute on function public.create_event(uuid,jsonb),public.create_events_from_type(uuid,date,int),public.mark_notifications_read(uuid[]),
 public.request_replacement(uuid,text),public.cancel_replacement(uuid),public.take_replacement(uuid) from public,anon;
grant execute on function public.create_event(uuid,jsonb),public.create_events_from_type(uuid,date,int),public.mark_notifications_read(uuid[]),
 public.request_replacement(uuid,text),public.cancel_replacement(uuid),public.take_replacement(uuid) to authenticated;
commit;
