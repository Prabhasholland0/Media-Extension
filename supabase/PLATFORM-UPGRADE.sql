-- MediaHub platform upgrade: 004 to 009 in one transaction, for the Supabase SQL editor.
-- Run once, after a backup. If any statement fails, nothing is changed.
-- The NLAG Service Team app keeps working: these steps only add tables and functions and keep its rules.
begin;
do $$ begin
 if to_regclass('public.organizations') is not null then raise exception 'The MediaHub platform is already installed on this database. Nothing was changed.'; end if;
 if to_regclass('public.schedules') is null then raise exception 'This is not the NLAG MediaHub database (public.schedules is missing). Nothing was changed.'; end if;
end $$;

-- ===== 004_platform.sql =====
-- MediaHub platform: many organizations, each with its own teams, positions,
-- members, events, services, service plans and schedules.
-- Apply after 001_schema.sql (it reuses public.profiles and the sign-up trigger).
-- Existing single-team tables are left untouched so the current app keeps working.

create table public.organizations(
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 80),
 join_code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now()
);
create table public.org_members(
 org_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 role text not null default 'member' check(role in ('owner','admin','member')),
 joined_at timestamptz not null default now(),
 primary key(org_id,user_id)
);
create index org_members_user_idx on public.org_members(user_id);

-- Composite (org_id,id) keys make every child row provably belong to one organization.
create table public.teams(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references public.organizations(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 60),
 sort_order int not null default 0,
 unique(org_id,id)
);
create table public.positions(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null, team_id uuid not null,
 name text not null check(length(trim(name)) between 1 and 60),
 sort_order int not null default 0,
 unique(org_id,id),
 foreign key(org_id,team_id) references public.teams(org_id,id) on delete cascade
);
create index positions_team_idx on public.positions(org_id,team_id);
create table public.member_positions(
 org_id uuid not null, user_id uuid not null, position_id uuid not null,
 primary key(org_id,user_id,position_id),
 foreign key(org_id,user_id) references public.org_members(org_id,user_id) on delete cascade,
 foreign key(org_id,position_id) references public.positions(org_id,id) on delete cascade
);
create index member_positions_position_idx on public.member_positions(org_id,position_id);

create table public.events(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references public.organizations(id) on delete cascade,
 title text not null check(length(trim(title)) between 1 and 120),
 event_date date not null,
 notes text not null default '' check(length(notes)<=2000),
 status text not null default 'draft' check(status in ('draft','published')),
 created_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(org_id,id)
);
create index events_org_date_idx on public.events(org_id,event_date);
create table public.event_services(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null, event_id uuid not null,
 name text not null check(length(trim(name)) between 1 and 60),
 starts_at time,
 sort_order int not null default 0,
 unique(org_id,id),
 foreign key(org_id,event_id) references public.events(org_id,id) on delete cascade
);
create index event_services_event_idx on public.event_services(org_id,event_id);
-- How many people each position needs in every service of the event.
create table public.event_needs(
 org_id uuid not null, event_id uuid not null, position_id uuid not null,
 quantity int not null check(quantity between 1 and 50),
 primary key(event_id,position_id),
 foreign key(org_id,event_id) references public.events(org_id,id) on delete cascade,
 foreign key(org_id,position_id) references public.positions(org_id,id) on delete cascade
);
create index event_needs_position_idx on public.event_needs(org_id,position_id);
-- The service plan: the ordered run sheet shared by every service of the event.
create table public.plan_items(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null, event_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 120),
 kind text not null default 'item' check(kind in ('header','item','song','media','message')),
 duration_minutes int not null default 0 check(duration_minutes between 0 and 600),
 notes text not null default '' check(length(notes)<=1000),
 sort_order int not null default 0,
 foreign key(org_id,event_id) references public.events(org_id,id) on delete cascade
);
create index plan_items_event_idx on public.plan_items(org_id,event_id);
create table public.plan_assignments(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null, service_id uuid not null, position_id uuid not null,
 slot int not null check(slot between 1 and 50),
 user_id uuid not null,
 status text not null default 'pending' check(status in ('pending','accepted','declined')),
 responded_at timestamptz,
 unique(service_id,position_id,slot),
 unique(service_id,user_id),
 foreign key(org_id,service_id) references public.event_services(org_id,id) on delete cascade,
 foreign key(org_id,position_id) references public.positions(org_id,id) on delete cascade,
 foreign key(org_id,user_id) references public.org_members(org_id,user_id) on delete cascade
);
create index plan_assignments_user_idx on public.plan_assignments(user_id);
create index plan_assignments_position_idx on public.plan_assignments(org_id,position_id);
-- Personal dates a member cannot serve, visible to admins of their organizations.
create table public.blockouts(
 user_id uuid not null references public.profiles(id) on delete cascade,
 day date not null,
 reason text not null default '' check(length(reason)<=120),
 primary key(user_id,day)
);

create function public.is_org_member(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.org_members where org_id=p_org and user_id=(select auth.uid()));
$$;
create function public.is_org_admin(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.org_members where org_id=p_org and user_id=(select auth.uid()) and role in ('owner','admin'));
$$;
create function public.can_see_event(p_org uuid,p_event uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_org_admin(p_org) or (public.is_org_member(p_org) and exists(select 1 from public.events where id=p_event and org_id=p_org and status='published'));
$$;

-- Lowering a need, or removing it, drops the assignments that no longer fit.
create function public.trim_assignments_to_needs() returns trigger language plpgsql security definer set search_path='' as $$
 begin
 delete from public.plan_assignments a using public.event_services s
 where s.id=a.service_id and s.event_id=old.event_id and a.position_id=old.position_id
 and (tg_op='DELETE' or a.slot>new.quantity);
 return null;
 end;
$$;
create trigger event_needs_trim after update or delete on public.event_needs for each row execute function public.trim_assignments_to_needs();
create function public.touch_event() returns trigger language plpgsql set search_path='' as $$
 begin new.updated_at:=now(); return new; end;
$$;
create trigger events_touch before update on public.events for each row execute function public.touch_event();

alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.teams enable row level security;
alter table public.positions enable row level security;
alter table public.member_positions enable row level security;
alter table public.events enable row level security;
alter table public.event_services enable row level security;
alter table public.event_needs enable row level security;
alter table public.plan_items enable row level security;
alter table public.plan_assignments enable row level security;
alter table public.blockouts enable row level security;

create policy org_read on public.organizations for select to authenticated using(public.is_org_member(id));
create policy org_rename on public.organizations for update to authenticated using(public.is_org_admin(id)) with check(public.is_org_admin(id));
create policy org_delete on public.organizations for delete to authenticated using(exists(select 1 from public.org_members where org_id=id and user_id=(select auth.uid()) and role='owner'));
create policy members_read on public.org_members for select to authenticated using(public.is_org_member(org_id));
create policy teams_read on public.teams for select to authenticated using(public.is_org_member(org_id));
create policy teams_write on public.teams for all to authenticated using(public.is_org_admin(org_id)) with check(public.is_org_admin(org_id));
create policy positions_read on public.positions for select to authenticated using(public.is_org_member(org_id));
create policy positions_write on public.positions for all to authenticated using(public.is_org_admin(org_id)) with check(public.is_org_admin(org_id));
create policy member_positions_read on public.member_positions for select to authenticated using(public.is_org_member(org_id));
create policy member_positions_write on public.member_positions for all to authenticated using(public.is_org_admin(org_id)) with check(public.is_org_admin(org_id));
create policy events_read on public.events for select to authenticated using(public.is_org_admin(org_id) or (status='published' and public.is_org_member(org_id)));
create policy events_write on public.events for all to authenticated using(public.is_org_admin(org_id)) with check(public.is_org_admin(org_id));
create policy services_read on public.event_services for select to authenticated using(public.can_see_event(org_id,event_id));
create policy services_write on public.event_services for all to authenticated using(public.is_org_admin(org_id)) with check(public.is_org_admin(org_id));
create policy needs_read on public.event_needs for select to authenticated using(public.can_see_event(org_id,event_id));
create policy needs_write on public.event_needs for all to authenticated using(public.is_org_admin(org_id)) with check(public.is_org_admin(org_id));
create policy plan_read on public.plan_items for select to authenticated using(public.can_see_event(org_id,event_id));
create policy plan_write on public.plan_items for all to authenticated using(public.is_org_admin(org_id)) with check(public.is_org_admin(org_id));
create policy assignments_read on public.plan_assignments for select to authenticated using(
 user_id=(select auth.uid()) or public.is_org_admin(org_id)
 or exists(select 1 from public.event_services s where s.id=service_id and public.can_see_event(s.org_id,s.event_id)));
create policy blockouts_read on public.blockouts for select to authenticated using(
 user_id=(select auth.uid()) or exists(select 1 from public.org_members m where m.user_id=blockouts.user_id and public.is_org_admin(m.org_id)));
create policy blockouts_write on public.blockouts for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

revoke all on public.organizations,public.org_members,public.teams,public.positions,public.member_positions,public.events,public.event_services,public.event_needs,public.plan_items,public.plan_assignments,public.blockouts from anon,authenticated;
grant select on public.organizations,public.org_members,public.plan_assignments to authenticated;
grant update(name) on public.organizations to authenticated;
grant delete on public.organizations to authenticated;
grant select,insert,update,delete on public.teams,public.positions,public.member_positions,public.events,public.event_services,public.event_needs,public.plan_items,public.blockouts to authenticated;

create function public.update_my_profile(p_name text,p_phone text) returns void language plpgsql security definer set search_path='' as $$
 begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if p_name is null or length(trim(p_name)) not between 1 and 100 then raise exception 'Enter your name'; end if;
 if p_phone is null or length(trim(p_phone))>30 then raise exception 'Phone number is too long'; end if;
 update public.profiles set full_name=trim(p_name),phone=trim(p_phone) where id=auth.uid();
 end;
$$;

-- Creates the organization, makes the caller its owner and seeds starter teams.
create function public.create_organization(p_name text,p_preset text) returns uuid language plpgsql security definer set search_path='' as $$
 declare oid uuid; tid uuid; team record; pos text; i int:=0; j int;
 begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if p_name is null or length(trim(p_name)) not between 1 and 80 then raise exception 'Enter an organization name'; end if;
 if p_preset is null or p_preset not in ('media','church','blank') then raise exception 'Unknown starter setup'; end if;
 if (select count(*) from public.org_members where user_id=auth.uid() and role='owner')>=20 then raise exception 'You already own 20 organizations'; end if;
 insert into public.organizations(name,created_by) values(trim(p_name),auth.uid()) returning id into oid;
 insert into public.org_members(org_id,user_id,role) values(oid,auth.uid(),'owner');
 for team in select * from jsonb_each(case p_preset
  when 'media' then '{"Video":["Producer","Director","CCU","Camera","Graphics"],"Audio":["Front of House","Monitors"],"Lighting":["Lighting Operator"]}'::jsonb
  when 'church' then '{"Media":["Producer","Camera","Graphics","Sound"],"Worship":["Worship Leader","Vocals","Keys","Guitar","Bass","Drums"],"Hospitality":["Greeter","Usher"]}'::jsonb
  else '{}'::jsonb end) loop
  i:=i+1; j:=0;
  insert into public.teams(org_id,name,sort_order) values(oid,team.key,i) returning id into tid;
  for pos in select jsonb_array_elements_text(team.value) loop
   j:=j+1; insert into public.positions(org_id,team_id,name,sort_order) values(oid,tid,pos,j);
  end loop;
 end loop;
 return oid;
 end;
$$;
create function public.join_organization(p_code text) returns uuid language plpgsql security definer set search_path='' as $$
 declare oid uuid;
 begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select id into oid from public.organizations where join_code=upper(trim(coalesce(p_code,'')));
 if oid is null then raise exception 'That invite code is not valid'; end if;
 insert into public.org_members(org_id,user_id) values(oid,auth.uid()) on conflict do nothing;
 return oid;
 end;
$$;
create function public.reset_join_code(p_org uuid) returns text language plpgsql security definer set search_path='' as $$
 declare code text;
 begin
 if not public.is_org_admin(p_org) then raise exception 'Admin access required'; end if;
 update public.organizations set join_code=upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)) where id=p_org returning join_code into code;
 return code;
 end;
$$;
create function public.set_member_role(p_org uuid,p_user uuid,p_role text) returns void language plpgsql security definer set search_path='' as $$
 begin
 if not public.is_org_admin(p_org) then raise exception 'Admin access required'; end if;
 if p_role is null or p_role not in ('admin','member') then raise exception 'Choose admin or member'; end if;
 if exists(select 1 from public.org_members where org_id=p_org and user_id=p_user and role='owner') then raise exception 'The owner role cannot be changed here'; end if;
 update public.org_members set role=p_role where org_id=p_org and user_id=p_user;
 if not found then raise exception 'Member not found'; end if;
 end;
$$;
-- Admins remove members; anyone may remove themselves, except the last owner.
create function public.remove_member(p_org uuid,p_user uuid) returns void language plpgsql security definer set search_path='' as $$
 begin
 if p_user is distinct from auth.uid() and not public.is_org_admin(p_org) then raise exception 'Admin access required'; end if;
 if exists(select 1 from public.org_members where org_id=p_org and user_id=p_user and role='owner') then raise exception 'The owner cannot be removed. Delete the organization instead.'; end if;
 delete from public.org_members where org_id=p_org and user_id=p_user;
 end;
$$;
-- Names for every member; email and phone only for admins.
create function public.org_roster(p_org uuid) returns table(user_id uuid,full_name text,email text,phone text,role text,joined_at timestamptz) language sql stable security definer set search_path='' as $$
 select m.user_id,p.full_name,case when public.is_org_admin(p_org) or m.user_id=auth.uid() then p.email else '' end,
  case when public.is_org_admin(p_org) or m.user_id=auth.uid() then p.phone else '' end,m.role,m.joined_at
 from public.org_members m join public.profiles p on p.id=m.user_id
 where m.org_id=p_org and public.is_org_member(p_org) order by lower(p.full_name);
$$;
-- Replaces one service's roster. Unchanged people keep their accept/decline response.
create function public.save_service_assignments(p_service uuid,p_assignments jsonb) returns void language plpgsql security definer set search_path='' as $$
 declare oid uuid; eid uuid;
 begin
 select org_id,event_id into oid,eid from public.event_services where id=p_service;
 if oid is null or not public.is_org_admin(oid) then raise exception 'Admin access required'; end if;
 if p_assignments is null or jsonb_typeof(p_assignments)<>'array' then raise exception 'Invalid assignments'; end if;
 create temp table incoming on commit drop as
  select (e->>'position_id')::uuid position_id,(e->>'slot')::int slot,(e->>'user_id')::uuid user_id from jsonb_array_elements(p_assignments) e;
 if exists(select 1 from pg_temp.incoming i where i.position_id is null or i.slot is null or i.user_id is null
  or not exists(select 1 from public.event_needs n where n.event_id=eid and n.position_id=i.position_id and i.slot between 1 and n.quantity)) then
  raise exception 'An assignment is outside the positions this event needs';
 end if;
 if exists(select 1 from pg_temp.incoming i where not exists(select 1 from public.org_members m where m.org_id=oid and m.user_id=i.user_id)) then raise exception 'Only members of this organization can be scheduled'; end if;
 if (select count(*) from pg_temp.incoming)<>(select count(distinct user_id) from pg_temp.incoming) then raise exception 'A person can hold only one position per service'; end if;
 if (select count(*) from pg_temp.incoming)<>(select count(distinct (position_id,slot)) from pg_temp.incoming) then raise exception 'A slot can hold only one person'; end if;
 delete from public.plan_assignments a where a.service_id=p_service
  and not exists(select 1 from pg_temp.incoming i where i.position_id=a.position_id and i.slot=a.slot and i.user_id=a.user_id);
 insert into public.plan_assignments(org_id,service_id,position_id,slot,user_id)
  select oid,p_service,i.position_id,i.slot,i.user_id from pg_temp.incoming i
  where not exists(select 1 from public.plan_assignments a where a.service_id=p_service and a.position_id=i.position_id and a.slot=i.slot and a.user_id=i.user_id);
 drop table pg_temp.incoming;
 end;
$$;
create function public.respond_assignment(p_assignment uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
 begin
 if p_status is null or p_status not in ('accepted','declined') then raise exception 'Choose accept or decline'; end if;
 update public.plan_assignments set status=p_status,responded_at=now() where id=p_assignment and user_id=auth.uid();
 if not found then raise exception 'Assignment not found'; end if;
 end;
$$;
-- Copies services, needs and the plan (not people) to a new date.
create function public.duplicate_event(p_event uuid,p_date date) returns uuid language plpgsql security definer set search_path='' as $$
 declare src public.events; nid uuid;
 begin
 select * into src from public.events where id=p_event;
 if src.id is null or not public.is_org_admin(src.org_id) then raise exception 'Admin access required'; end if;
 if p_date is null then raise exception 'Choose a date'; end if;
 insert into public.events(org_id,title,event_date,notes,created_by) values(src.org_id,src.title,p_date,src.notes,auth.uid()) returning id into nid;
 insert into public.event_services(org_id,event_id,name,starts_at,sort_order) select org_id,nid,name,starts_at,sort_order from public.event_services where event_id=p_event;
 insert into public.event_needs(org_id,event_id,position_id,quantity) select org_id,nid,position_id,quantity from public.event_needs where event_id=p_event;
 insert into public.plan_items(org_id,event_id,title,kind,duration_minutes,notes,sort_order) select org_id,nid,title,kind,duration_minutes,notes,sort_order from public.plan_items where event_id=p_event;
 return nid;
 end;
$$;

revoke execute on function public.trim_assignments_to_needs(),public.touch_event() from public,anon,authenticated;
revoke execute on function public.is_org_member(uuid),public.is_org_admin(uuid),public.can_see_event(uuid,uuid),public.update_my_profile(text,text),public.create_organization(text,text),public.join_organization(text),public.reset_join_code(uuid),public.set_member_role(uuid,uuid,text),public.remove_member(uuid,uuid),public.org_roster(uuid),public.save_service_assignments(uuid,jsonb),public.respond_assignment(uuid,text),public.duplicate_event(uuid,date) from public,anon;
grant execute on function public.is_org_member(uuid),public.is_org_admin(uuid),public.can_see_event(uuid,uuid),public.update_my_profile(text,text),public.create_organization(text,text),public.join_organization(text),public.reset_join_code(uuid),public.set_member_role(uuid,uuid,text),public.remove_member(uuid,uuid),public.org_roster(uuid),public.save_service_assignments(uuid,jsonb),public.respond_assignment(uuid,text),public.duplicate_event(uuid,date) to authenticated;

-- ===== 005_phase1_stabilize.sql =====
-- Phase 1 stabilization. Apply after 004_platform.sql.
-- 1. Keeps accounts created in the MediaHub platform out of the NLAG Service Team app.
--    Both apps share auth.users and public.profiles, so without this every platform
--    sign-up became an "active member" of NLAG and NLAG admins could read their contact details.
-- 2. Lets an organization creator's account be deleted (organizations.created_by blocked it).
-- 3. Shows invite codes only to organization admins.
-- 4. Throttles invite-code guessing.

-- Existing accounts all came from the NLAG app, so they keep access.
alter table public.profiles add column legacy_team boolean not null default true;

create or replace function public.handle_new_member() returns trigger language plpgsql security definer set search_path='' as $$
 begin
 insert into public.profiles(id,email,full_name,legacy_team)
 values(new.id,coalesce(new.email,''),left(coalesce(new.raw_user_meta_data->>'full_name',''),100),
  coalesce(new.raw_user_meta_data->>'app','')<>'mediahub-platform');
 return new;
 end;
$$;

create or replace function public.is_team_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=(select auth.uid()) and is_admin and active and legacy_team);
$$;
create or replace function public.is_active_member() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=(select auth.uid()) and active and legacy_team);
$$;
drop policy if exists profile_read on public.profiles;
create policy profile_read on public.profiles for select to authenticated
using(id=(select auth.uid()) or (legacy_team and public.is_team_admin()));

create or replace function public.manage_member(p_user uuid,p_skills text[],p_active boolean) returns void language plpgsql security definer set search_path='' as $$
 declare affected uuid[];
 begin
 perform pg_advisory_xact_lock(823714);
 if not public.is_team_admin() then raise exception 'Admin access required'; end if;
 if p_user=auth.uid() and not p_active then raise exception 'You cannot deactivate your own admin account'; end if;
 if p_skills is null or array_position(p_skills,null) is not null or not(p_skills <@ array['camera','producer','ccu']::text[]) or p_active is null then raise exception 'Invalid skills or account status'; end if;
 if not exists(select 1 from public.profiles where id=p_user and legacy_team) then raise exception 'Member not found'; end if;
 select array_agg(distinct schedule_id) into affected from public.assignments where user_id=p_user and (not p_active or not((case when position like 'cam_%' then 'camera' else position end)=any(p_skills)));
 update public.schedules set status='draft',revision=revision+1,updated_at=now() where id=any(affected);
 delete from public.assignments where user_id=p_user and (not p_active or not((case when position like 'cam_%' then 'camera' else position end)=any(p_skills)));
 update public.profiles set skills=p_skills,active=p_active where id=p_user;
 end;
$$;

-- Only defined when permanent-delete.sql was applied.
do $$ begin
 if to_regprocedure('public.permanently_delete_member(uuid)') is not null then
  execute $f$
  create or replace function public.permanently_delete_member(p_user uuid) returns void language plpgsql security definer set search_path='' as $b$
  begin
   perform pg_advisory_xact_lock(823714);
   if auth.uid() is null or not public.is_team_admin() then raise exception 'Admin access required';end if;
   if p_user is null or p_user=auth.uid() then raise exception 'You cannot remove your own account';end if;
   if exists(select 1 from public.profiles where id=p_user and is_admin) then raise exception 'Administrator accounts cannot be removed here';end if;
   if not exists(select 1 from public.profiles where id=p_user and legacy_team) then raise exception 'Member not found';end if;
   if exists(select 1 from public.org_members where user_id=p_user and role='owner') then raise exception 'This person owns a MediaHub organization and must delete or hand it over first';end if;
   update public.schedules set status='draft',revision=revision+1,updated_at=now() where id in(select schedule_id from public.assignments where user_id=p_user);
   delete from public.assignments where user_id=p_user;
   update public.schedules set updated_by=null where updated_by=p_user;
   delete from auth.users where id=p_user;
  end;
  $b$;
  $f$;
 end if;
end $$;

alter table public.organizations alter column created_by drop not null;
alter table public.organizations drop constraint organizations_created_by_fkey;
alter table public.organizations add constraint organizations_created_by_fkey foreign key(created_by) references public.profiles(id) on delete set null;

-- Members may read an organization's name, not its invite code.
revoke select on public.organizations from authenticated;
grant select(id,name,created_by,created_at) on public.organizations to authenticated;
create function public.org_invite_code(p_org uuid) returns text language sql stable security definer set search_path='' as $$
 select join_code from public.organizations where id=p_org and public.is_org_admin(p_org);
$$;

create schema if not exists platform_private;
revoke all on schema platform_private from public,anon,authenticated;
create table platform_private.join_attempts(user_id uuid primary key,window_start timestamptz not null,failures int not null);
create or replace function public.join_organization(p_code text) returns uuid language plpgsql security definer set search_path='' as $$
 declare oid uuid; tries int;
 begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 select failures into tries from platform_private.join_attempts where user_id=auth.uid() and window_start>now()-interval '1 hour';
 if coalesce(tries,0)>=10 then raise exception 'Too many invalid invite codes. Try again in an hour.'; end if;
 select id into oid from public.organizations where join_code=upper(trim(coalesce(p_code,'')));
 if oid is null then
  -- Count the failure in its own row; the raise below would roll it back, so return null instead.
  insert into platform_private.join_attempts values(auth.uid(),now(),1)
  on conflict(user_id) do update set failures=case when join_attempts.window_start<=now()-interval '1 hour' then 1 else join_attempts.failures+1 end,
   window_start=case when join_attempts.window_start<=now()-interval '1 hour' then now() else join_attempts.window_start end;
  return null;
 end if;
 insert into public.org_members(org_id,user_id) values(oid,auth.uid()) on conflict do nothing;
 return oid;
 end;
$$;

revoke execute on function public.org_invite_code(uuid) from public,anon;
grant execute on function public.org_invite_code(uuid) to authenticated;

-- ===== 006_tenant_core.sql =====
-- Phase 2: shared platform foundation. Apply after 005_phase1_stabilize.sql.
-- Adds church profile settings, campuses, configurable roles with permissions,
-- department leaders, email invitations, an append-only activity log, organization
-- suspension and a metadata-only platform admin view.
-- Every write check now asks for a named permission instead of "is admin".

-- ---------- organization profile ----------
alter table public.organizations
 add column time_zone text not null default 'Asia/Kolkata',
 add column locale text not null default 'en' check(locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
 add column contact_email text not null default '' check(length(contact_email)<=254),
 add column contact_phone text not null default '' check(length(contact_phone)<=30),
 add column address text not null default '' check(length(address)<=300),
 add column website text not null default '' check(length(website)<=200),
 add column status text not null default 'active' check(status in ('active','suspended')),
 add column onboarded_at timestamptz;
create function public.check_time_zone() returns trigger language plpgsql set search_path='' as $$
 begin
 if new.time_zone is not null then perform now() at time zone new.time_zone; end if;
 return new;
 exception when others then raise exception 'Unknown time zone %',new.time_zone;
 end;
$$;
create trigger organizations_time_zone before insert or update of time_zone on public.organizations for each row execute function public.check_time_zone();
grant select(time_zone,locale,contact_email,contact_phone,address,website,status,onboarded_at) on public.organizations to authenticated;
grant update(time_zone,locale,contact_email,contact_phone,address,website,onboarded_at) on public.organizations to authenticated;

-- ---------- roles and permissions ----------
-- Sensitive permissions (children, prayer, care, finance, safety) arrive with their modules.
create table public.org_roles(
 org_id uuid not null references public.organizations(id) on delete cascade,
 key text not null check(key ~ '^[a-z][a-z0-9_]{1,30}$'),
 name text not null check(length(trim(name)) between 1 and 40),
 permissions text[] not null default '{}' check(permissions <@ array['org.manage','members.manage','members.contact.read','roles.manage','campuses.manage','departments.manage','events.manage','schedule.manage','audit.read']::text[]),
 is_system boolean not null default false,
 primary key(org_id,key)
);
create function public.seed_org_roles() returns trigger language plpgsql security definer set search_path='' as $$
 begin
 insert into public.org_roles(org_id,key,name,permissions,is_system) values
  (new.id,'owner','Owner',array['org.manage','members.manage','members.contact.read','roles.manage','campuses.manage','departments.manage','events.manage','schedule.manage','audit.read'],true),
  (new.id,'admin','Church admin',array['org.manage','members.manage','members.contact.read','roles.manage','campuses.manage','departments.manage','events.manage','schedule.manage','audit.read'],true),
  (new.id,'scheduler','Scheduler',array['members.contact.read','events.manage','schedule.manage'],true),
  (new.id,'member','Member','{}',true);
 return null;
 end;
$$;
create trigger organizations_seed_roles after insert on public.organizations for each row execute function public.seed_org_roles();
insert into public.org_roles(org_id,key,name,permissions,is_system)
 select o.id,r.key,r.name,r.perms,true from public.organizations o cross join (values
  ('owner','Owner',array['org.manage','members.manage','members.contact.read','roles.manage','campuses.manage','departments.manage','events.manage','schedule.manage','audit.read']),
  ('admin','Church admin',array['org.manage','members.manage','members.contact.read','roles.manage','campuses.manage','departments.manage','events.manage','schedule.manage','audit.read']),
  ('scheduler','Scheduler',array['members.contact.read','events.manage','schedule.manage']),
  ('member','Member','{}'::text[])) r(key,name,perms);
alter table public.org_members drop constraint org_members_role_check;
alter table public.org_members add constraint org_members_role_fkey foreign key(org_id,role) references public.org_roles(org_id,key) on update cascade;

-- Owners hold every permission. Suspended organizations keep read access but no permissions.
create function public.has_permission(p_org uuid,p_perm text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.org_members m
  join public.org_roles r on r.org_id=m.org_id and r.key=m.role
  join public.organizations o on o.id=m.org_id
  where m.org_id=p_org and m.user_id=(select auth.uid()) and o.status='active'
  and (m.role='owner' or p_perm=any(r.permissions)));
$$;
create or replace function public.is_org_admin(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.has_permission(p_org,'org.manage');
$$;
create function public.my_permissions(p_org uuid) returns text[] language sql stable security definer set search_path='' as $$
 select coalesce((select case when m.role='owner' then (select permissions from public.org_roles where org_id=p_org and key='owner') else r.permissions end
  from public.org_members m join public.org_roles r on r.org_id=m.org_id and r.key=m.role join public.organizations o on o.id=m.org_id
  where m.org_id=p_org and m.user_id=(select auth.uid()) and o.status='active'),'{}');
$$;
-- True when every permission of a role is one the caller holds (blocks privilege escalation).
create function public.can_grant_role(p_org uuid,p_role text) returns boolean language sql stable security definer set search_path='' as $$
 select p_role<>'owner' and exists(select 1 from public.org_roles r where r.org_id=p_org and r.key=p_role and r.permissions <@ public.my_permissions(p_org));
$$;

-- ---------- campuses ----------
create table public.campuses(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references public.organizations(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 80),
 address text not null default '' check(length(address)<=300),
 sort_order int not null default 0,
 archived_at timestamptz,
 unique(org_id,id)
);
create index campuses_org_idx on public.campuses(org_id);
alter table public.events add column campus_id uuid;
alter table public.events add constraint events_campus_fkey foreign key(org_id,campus_id) references public.campuses(org_id,id);
create index events_campus_idx on public.events(org_id,campus_id);

-- ---------- departments ----------
-- "teams" is the department table; the UI calls them departments.
alter table public.teams
 add column description text not null default '' check(length(description)<=500),
 add column archived_at timestamptz;
create table public.department_members(
 org_id uuid not null, team_id uuid not null, user_id uuid not null,
 dept_role text not null default 'member' check(dept_role in ('leader','coordinator','member')),
 primary key(team_id,user_id),
 foreign key(org_id,team_id) references public.teams(org_id,id) on delete cascade,
 foreign key(org_id,user_id) references public.org_members(org_id,user_id) on delete cascade
);
create index department_members_user_idx on public.department_members(org_id,user_id);
create function public.leads_department(p_org uuid,p_team uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.department_members d join public.organizations o on o.id=d.org_id
  where d.org_id=p_org and (p_team is null or d.team_id=p_team) and d.user_id=(select auth.uid()) and d.dept_role in ('leader','coordinator') and o.status='active');
$$;
-- Schedulers fill every position; department leaders and coordinators fill their own department's.
create function public.can_schedule_position(p_org uuid,p_position uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.has_permission(p_org,'schedule.manage') or exists(select 1 from public.positions p where p.id=p_position and p.org_id=p_org and public.leads_department(p_org,p.team_id));
$$;
create or replace function public.can_see_event(p_org uuid,p_event uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.has_permission(p_org,'events.manage') or public.has_permission(p_org,'schedule.manage') or public.leads_department(p_org,null)
  or (public.is_org_member(p_org) and exists(select 1 from public.events where id=p_event and org_id=p_org and status='published'));
$$;

-- ---------- invitations ----------
create table public.invitations(
 id uuid primary key default gen_random_uuid(),
 org_id uuid not null references public.organizations(id) on delete cascade,
 email text not null check(length(email)<=254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
 role text not null,
 invited_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(),
 accepted_at timestamptz, closed_at timestamptz,
 foreign key(org_id,role) references public.org_roles(org_id,key) on update cascade
);
create unique index invitations_open_idx on public.invitations(org_id,lower(email)) where accepted_at is null and closed_at is null;

-- ---------- activity log ----------
create table public.audit_log(
 id bigint generated always as identity primary key,
 org_id uuid not null references public.organizations(id) on delete cascade,
 actor_id uuid,
 action text not null, entity text not null, entity_id text,
 detail jsonb not null default '{}',
 at timestamptz not null default now()
);
create index audit_log_org_idx on public.audit_log(org_id,at desc);
-- Records who changed what. Updates keep only the changed fields.
create function public.audit_row() returns trigger language plpgsql security definer set search_path='' as $$
 declare r jsonb:=to_jsonb(coalesce(new,old)); o jsonb:=case when tg_op='UPDATE' then to_jsonb(old) end; org uuid; changed jsonb;
 begin
 org:=case when tg_table_name='organizations' then (r->>'id')::uuid else (r->>'org_id')::uuid end;
 if not exists(select 1 from public.organizations where id=org) then return null; end if;
 if tg_op='UPDATE' then
  select coalesce(jsonb_object_agg(k,r->k),'{}') into changed from jsonb_object_keys(r) k where r->k is distinct from o->k and k not in ('updated_at','join_code');
  if changed='{}' then return null; end if;
 else changed:=r-'join_code'; end if;
 insert into public.audit_log(org_id,actor_id,action,entity,entity_id,detail)
 values(org,auth.uid(),lower(tg_op),tg_table_name,coalesce(r->>'id',r->>'user_id'),changed);
 return null;
 end;
$$;
create trigger audit_organizations after update on public.organizations for each row execute function public.audit_row();
create trigger audit_org_members after insert or update or delete on public.org_members for each row execute function public.audit_row();
create trigger audit_org_roles after insert or update or delete on public.org_roles for each row execute function public.audit_row();
create trigger audit_invitations after insert or update on public.invitations for each row execute function public.audit_row();
create trigger audit_campuses after insert or update or delete on public.campuses for each row execute function public.audit_row();
create trigger audit_teams after insert or update or delete on public.teams for each row execute function public.audit_row();
create trigger audit_positions after insert or update or delete on public.positions for each row execute function public.audit_row();
create trigger audit_department_members after insert or update or delete on public.department_members for each row execute function public.audit_row();
create trigger audit_events after insert or update or delete on public.events for each row execute function public.audit_row();
create trigger audit_plan_assignments after insert or update or delete on public.plan_assignments for each row execute function public.audit_row();

-- ---------- platform operators ----------
create table public.platform_admins(user_id uuid primary key references public.profiles(id) on delete cascade);
create function public.is_platform_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.platform_admins where user_id=(select auth.uid()));
$$;

-- ---------- row-level security ----------
alter table public.org_roles enable row level security;
alter table public.campuses enable row level security;
alter table public.department_members enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_log enable row level security;
alter table public.platform_admins enable row level security;

create policy roles_read on public.org_roles for select to authenticated using(public.is_org_member(org_id));
create policy campuses_read on public.campuses for select to authenticated using(public.is_org_member(org_id));
create policy campuses_write on public.campuses for all to authenticated using(public.has_permission(org_id,'campuses.manage')) with check(public.has_permission(org_id,'campuses.manage'));
create policy dept_members_read on public.department_members for select to authenticated using(public.is_org_member(org_id));
create policy dept_members_write on public.department_members for all to authenticated using(public.has_permission(org_id,'departments.manage')) with check(public.has_permission(org_id,'departments.manage'));
create policy invitations_read on public.invitations for select to authenticated using(public.has_permission(org_id,'members.manage'));
create policy audit_read on public.audit_log for select to authenticated using(public.has_permission(org_id,'audit.read'));

-- Replace "admin" checks from 004 with named permissions.
drop policy org_rename on public.organizations;
create policy org_update on public.organizations for update to authenticated using(public.has_permission(id,'org.manage')) with check(public.has_permission(id,'org.manage'));
drop policy teams_write on public.teams;
create policy teams_write on public.teams for all to authenticated using(public.has_permission(org_id,'departments.manage')) with check(public.has_permission(org_id,'departments.manage'));
drop policy positions_write on public.positions;
create policy positions_write on public.positions for all to authenticated using(public.has_permission(org_id,'departments.manage')) with check(public.has_permission(org_id,'departments.manage'));
drop policy member_positions_write on public.member_positions;
create policy member_positions_write on public.member_positions for all to authenticated using(public.has_permission(org_id,'departments.manage')) with check(public.has_permission(org_id,'departments.manage'));
drop policy events_read on public.events;
create policy events_read on public.events for select to authenticated using(public.can_see_event(org_id,id));
drop policy events_write on public.events;
create policy events_write on public.events for all to authenticated using(public.has_permission(org_id,'events.manage')) with check(public.has_permission(org_id,'events.manage'));
drop policy services_write on public.event_services;
create policy services_write on public.event_services for all to authenticated using(public.has_permission(org_id,'events.manage')) with check(public.has_permission(org_id,'events.manage'));
drop policy needs_write on public.event_needs;
create policy needs_write on public.event_needs for all to authenticated using(public.has_permission(org_id,'events.manage')) with check(public.has_permission(org_id,'events.manage'));
drop policy plan_write on public.plan_items;
create policy plan_write on public.plan_items for all to authenticated using(public.has_permission(org_id,'events.manage')) with check(public.has_permission(org_id,'events.manage'));
drop policy assignments_read on public.plan_assignments;
create policy assignments_read on public.plan_assignments for select to authenticated using(
 user_id=(select auth.uid()) or exists(select 1 from public.event_services s where s.id=service_id and public.can_see_event(s.org_id,s.event_id)));
drop policy blockouts_read on public.blockouts;
create policy blockouts_read on public.blockouts for select to authenticated using(
 user_id=(select auth.uid()) or exists(select 1 from public.org_members m where m.user_id=blockouts.user_id
  and (public.has_permission(m.org_id,'schedule.manage') or public.leads_department(m.org_id,null))));

revoke all on public.org_roles,public.campuses,public.department_members,public.invitations,public.audit_log,public.platform_admins from anon,authenticated;
grant select on public.org_roles,public.invitations,public.audit_log to authenticated;
grant select,insert,update,delete on public.campuses,public.department_members to authenticated;

-- ---------- functions ----------
create or replace function public.reset_join_code(p_org uuid) returns text language plpgsql security definer set search_path='' as $$
 declare code text;
 begin
 if not public.has_permission(p_org,'members.manage') then raise exception 'You do not have permission to manage people'; end if;
 update public.organizations set join_code=upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)) where id=p_org returning join_code into code;
 return code;
 end;
$$;
create or replace function public.org_invite_code(p_org uuid) returns text language sql stable security definer set search_path='' as $$
 select join_code from public.organizations where id=p_org and public.has_permission(p_org,'members.manage');
$$;
create or replace function public.set_member_role(p_org uuid,p_user uuid,p_role text) returns void language plpgsql security definer set search_path='' as $$
 begin
 if not public.has_permission(p_org,'members.manage') then raise exception 'You do not have permission to manage people'; end if;
 if p_user=auth.uid() then raise exception 'You cannot change your own role'; end if;
 if exists(select 1 from public.org_members where org_id=p_org and user_id=p_user and role='owner') then raise exception 'The owner role cannot be changed here'; end if;
 if not public.can_grant_role(p_org,p_role) then raise exception 'You cannot give a role with permissions you do not have'; end if;
 update public.org_members set role=p_role where org_id=p_org and user_id=p_user;
 if not found then raise exception 'Member not found'; end if;
 end;
$$;
create or replace function public.remove_member(p_org uuid,p_user uuid) returns void language plpgsql security definer set search_path='' as $$
 begin
 if p_user is distinct from auth.uid() and not public.has_permission(p_org,'members.manage') then raise exception 'You do not have permission to manage people'; end if;
 if exists(select 1 from public.org_members where org_id=p_org and user_id=p_user and role='owner') then raise exception 'The owner cannot be removed. Transfer ownership or delete the organization instead.'; end if;
 if p_user is distinct from auth.uid() and not exists(select 1 from public.org_members m join public.org_roles r on r.org_id=m.org_id and r.key=m.role where m.org_id=p_org and m.user_id=p_user and r.permissions <@ public.my_permissions(p_org)) then
  raise exception 'You cannot remove someone with permissions you do not have';
 end if;
 delete from public.org_members where org_id=p_org and user_id=p_user;
 end;
$$;
create function public.transfer_ownership(p_org uuid,p_user uuid) returns void language plpgsql security definer set search_path='' as $$
 begin
 if not exists(select 1 from public.org_members where org_id=p_org and user_id=auth.uid() and role='owner') then raise exception 'Only the owner can transfer ownership'; end if;
 if p_user=auth.uid() or not exists(select 1 from public.org_members where org_id=p_org and user_id=p_user) then raise exception 'Choose another member of this organization'; end if;
 update public.org_members set role='admin' where org_id=p_org and user_id=auth.uid();
 update public.org_members set role='owner' where org_id=p_org and user_id=p_user;
 end;
$$;
drop function public.org_roster(uuid);
create function public.org_roster(p_org uuid) returns table(user_id uuid,full_name text,email text,phone text,role text,joined_at timestamptz) language sql stable security definer set search_path='' as $$
 select m.user_id,p.full_name,
  case when public.has_permission(p_org,'members.contact.read') or m.user_id=auth.uid() then p.email else '' end,
  case when public.has_permission(p_org,'members.contact.read') or m.user_id=auth.uid() then p.phone else '' end,m.role,m.joined_at
 from public.org_members m join public.profiles p on p.id=m.user_id
 where m.org_id=p_org and public.is_org_member(p_org) order by lower(p.full_name);
$$;

create function public.save_role(p_org uuid,p_key text,p_name text,p_permissions text[]) returns void language plpgsql security definer set search_path='' as $$
 begin
 if not public.has_permission(p_org,'roles.manage') then raise exception 'You do not have permission to manage roles'; end if;
 if p_key='owner' then raise exception 'The owner role cannot be edited'; end if;
 if p_permissions is null or array_position(p_permissions,null) is not null then raise exception 'Invalid permissions'; end if;
 if not (p_permissions <@ public.my_permissions(p_org)) then raise exception 'You cannot give a role permissions you do not have'; end if;
 if exists(select 1 from public.org_roles where org_id=p_org and key=p_key and not (permissions <@ public.my_permissions(p_org))) then raise exception 'You cannot edit a role with permissions you do not have'; end if;
 insert into public.org_roles(org_id,key,name,permissions) values(p_org,p_key,trim(p_name),p_permissions)
 on conflict(org_id,key) do update set name=excluded.name,permissions=excluded.permissions;
 end;
$$;
create function public.delete_role(p_org uuid,p_key text) returns void language plpgsql security definer set search_path='' as $$
 begin
 if not public.has_permission(p_org,'roles.manage') then raise exception 'You do not have permission to manage roles'; end if;
 if exists(select 1 from public.org_roles where org_id=p_org and key=p_key and is_system) then raise exception 'Built-in roles cannot be deleted'; end if;
 if exists(select 1 from public.org_members where org_id=p_org and role=p_key) then raise exception 'Move everyone out of this role first'; end if;
 update public.invitations set closed_at=now() where org_id=p_org and role=p_key and accepted_at is null and closed_at is null;
 delete from public.invitations where org_id=p_org and role=p_key;
 delete from public.org_roles where org_id=p_org and key=p_key;
 end;
$$;

-- Repeat invitations to the same email update the open one instead of piling up.
create function public.invite_member(p_org uuid,p_email text,p_role text) returns uuid language plpgsql security definer set search_path='' as $$
 declare iid uuid; mail text:=lower(trim(coalesce(p_email,'')));
 begin
 if not public.has_permission(p_org,'members.manage') then raise exception 'You do not have permission to invite people'; end if;
 if not public.can_grant_role(p_org,p_role) then raise exception 'You cannot invite someone into a role with permissions you do not have'; end if;
 if exists(select 1 from public.org_members m join public.profiles p on p.id=m.user_id where m.org_id=p_org and lower(p.email)=mail) then raise exception 'That person is already a member'; end if;
 if (select count(*) from public.invitations where org_id=p_org and created_at>now()-interval '1 day')>=200 then raise exception 'Daily invitation limit reached'; end if;
 select id into iid from public.invitations where org_id=p_org and lower(email)=mail and accepted_at is null and closed_at is null;
 if iid is null then
  insert into public.invitations(org_id,email,role,invited_by) values(p_org,mail,p_role,auth.uid()) returning id into iid;
 else
  update public.invitations set role=p_role where id=iid and role<>p_role;
 end if;
 return iid;
 end;
$$;
create function public.revoke_invitation(p_invitation uuid) returns void language plpgsql security definer set search_path='' as $$
 begin
 update public.invitations set closed_at=now() where id=p_invitation and accepted_at is null and closed_at is null and public.has_permission(org_id,'members.manage');
 if not found then raise exception 'Invitation not found'; end if;
 end;
$$;
-- Invitations are matched to the signed-in account's confirmed email address.
create function public.my_invitations() returns table(id uuid,org_id uuid,org_name text,role_name text,invited_by_name text,created_at timestamptz) language plpgsql stable security definer set search_path='' as $$
 begin
 return query select i.id,i.org_id,o.name,r.name,coalesce(p.full_name,''),i.created_at
 from public.invitations i join public.organizations o on o.id=i.org_id join public.org_roles r on r.org_id=i.org_id and r.key=i.role
 left join public.profiles p on p.id=i.invited_by
 join auth.users u on u.id=auth.uid() and u.email_confirmed_at is not null and lower(u.email)=i.email
 where i.accepted_at is null and i.closed_at is null and o.status='active'
 and not exists(select 1 from public.org_members m where m.org_id=i.org_id and m.user_id=auth.uid());
 end;
$$;
create function public.answer_invitation(p_invitation uuid,p_accept boolean) returns uuid language plpgsql security definer set search_path='' as $$
 declare inv public.invitations;
 begin
 select i.* into inv from public.invitations i join auth.users u on u.id=auth.uid() and u.email_confirmed_at is not null and lower(u.email)=i.email
 where i.id=p_invitation and i.accepted_at is null and i.closed_at is null;
 if inv.id is null then raise exception 'Invitation not found'; end if;
 if p_accept then
  insert into public.org_members(org_id,user_id,role) values(inv.org_id,auth.uid(),inv.role) on conflict do nothing;
  update public.invitations set accepted_at=now() where id=inv.id;
  return inv.org_id;
 end if;
 update public.invitations set closed_at=now() where id=inv.id;
 return null;
 end;
$$;

-- Schedulers replace a whole roster; department leaders only change their department's seats.
create or replace function public.save_service_assignments(p_service uuid,p_assignments jsonb) returns void language plpgsql security definer set search_path='' as $$
 declare oid uuid; eid uuid;
 begin
 select org_id,event_id into oid,eid from public.event_services where id=p_service;
 if oid is null or not (public.has_permission(oid,'schedule.manage') or public.leads_department(oid,null)) then raise exception 'You do not have permission to schedule people'; end if;
 if p_assignments is null or jsonb_typeof(p_assignments)<>'array' then raise exception 'Invalid assignments'; end if;
 create temp table incoming on commit drop as
  select (e->>'position_id')::uuid position_id,(e->>'slot')::int slot,(e->>'user_id')::uuid user_id from jsonb_array_elements(p_assignments) e;
 if exists(select 1 from pg_temp.incoming i where i.position_id is null or i.slot is null or i.user_id is null) then raise exception 'Invalid assignments'; end if;
 -- Seats the caller may not change keep their current people.
 delete from pg_temp.incoming i where not public.can_schedule_position(oid,i.position_id);
 insert into pg_temp.incoming select a.position_id,a.slot,a.user_id from public.plan_assignments a where a.service_id=p_service and not public.can_schedule_position(oid,a.position_id);
 if exists(select 1 from pg_temp.incoming i where not exists(select 1 from public.event_needs n where n.event_id=eid and n.position_id=i.position_id and i.slot between 1 and n.quantity)) then
  raise exception 'An assignment is outside the positions this event needs';
 end if;
 if exists(select 1 from pg_temp.incoming i where not exists(select 1 from public.org_members m where m.org_id=oid and m.user_id=i.user_id)) then raise exception 'Only members of this organization can be scheduled'; end if;
 if (select count(*) from pg_temp.incoming)<>(select count(distinct user_id) from pg_temp.incoming) then raise exception 'A person can hold only one position per service'; end if;
 if (select count(*) from pg_temp.incoming)<>(select count(distinct (position_id,slot)) from pg_temp.incoming) then raise exception 'A slot can hold only one person'; end if;
 delete from public.plan_assignments a where a.service_id=p_service
  and not exists(select 1 from pg_temp.incoming i where i.position_id=a.position_id and i.slot=a.slot and i.user_id=a.user_id);
 insert into public.plan_assignments(org_id,service_id,position_id,slot,user_id)
  select oid,p_service,i.position_id,i.slot,i.user_id from pg_temp.incoming i
  where not exists(select 1 from public.plan_assignments a where a.service_id=p_service and a.position_id=i.position_id and a.slot=i.slot and a.user_id=i.user_id);
 drop table pg_temp.incoming;
 end;
$$;
create or replace function public.duplicate_event(p_event uuid,p_date date) returns uuid language plpgsql security definer set search_path='' as $$
 declare src public.events; nid uuid;
 begin
 select * into src from public.events where id=p_event;
 if src.id is null or not public.has_permission(src.org_id,'events.manage') then raise exception 'You do not have permission to manage events'; end if;
 if p_date is null then raise exception 'Choose a date'; end if;
 insert into public.events(org_id,title,event_date,notes,campus_id,created_by) values(src.org_id,src.title,p_date,src.notes,src.campus_id,auth.uid()) returning id into nid;
 insert into public.event_services(org_id,event_id,name,starts_at,sort_order) select org_id,nid,name,starts_at,sort_order from public.event_services where event_id=p_event;
 insert into public.event_needs(org_id,event_id,position_id,quantity) select org_id,nid,position_id,quantity from public.event_needs where event_id=p_event;
 insert into public.plan_items(org_id,event_id,title,kind,duration_minutes,notes,sort_order) select org_id,nid,title,kind,duration_minutes,notes,sort_order from public.plan_items where event_id=p_event;
 return nid;
 end;
$$;

-- Platform operators see organization metadata only, never church records.
create function public.platform_organizations() returns table(id uuid,name text,status text,created_at timestamptz,members bigint,events bigint) language sql stable security definer set search_path='' as $$
 select o.id,o.name,o.status,o.created_at,(select count(*) from public.org_members m where m.org_id=o.id),(select count(*) from public.events e where e.org_id=o.id)
 from public.organizations o where public.is_platform_admin() order by o.created_at desc;
$$;
create function public.set_organization_status(p_org uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
 begin
 if not public.is_platform_admin() then raise exception 'Platform administrator access required'; end if;
 if p_status not in ('active','suspended') then raise exception 'Invalid status'; end if;
 update public.organizations set status=p_status where id=p_org;
 end;
$$;

revoke execute on function public.check_time_zone(),public.seed_org_roles(),public.audit_row() from public,anon,authenticated;
revoke execute on function public.has_permission(uuid,text),public.my_permissions(uuid),public.can_grant_role(uuid,text),public.leads_department(uuid,uuid),public.can_schedule_position(uuid,uuid),public.is_platform_admin(),public.transfer_ownership(uuid,uuid),public.org_roster(uuid),public.save_role(uuid,text,text,text[]),public.delete_role(uuid,text),public.invite_member(uuid,text,text),public.revoke_invitation(uuid),public.my_invitations(),public.answer_invitation(uuid,boolean),public.platform_organizations(),public.set_organization_status(uuid,text) from public,anon;
grant execute on function public.has_permission(uuid,text),public.my_permissions(uuid),public.can_grant_role(uuid,text),public.leads_department(uuid,uuid),public.can_schedule_position(uuid,uuid),public.is_platform_admin(),public.transfer_ownership(uuid,uuid),public.org_roster(uuid),public.save_role(uuid,text,text,text[]),public.delete_role(uuid,text),public.invite_member(uuid,text,text),public.revoke_invitation(uuid),public.my_invitations(),public.answer_invitation(uuid,boolean),public.platform_organizations(),public.set_organization_status(uuid,text) to authenticated;

-- ===== 007_scheduling.sql =====
-- MediaHub platform, Phase 3a: universal scheduling.
-- Additive. Apply after 006_tenant_core.sql. Adds event cancel/complete states, an atomic create_event,
-- reusable service types with weekly scheduling, replacement requests, and in-app notifications.
-- Email delivery is not part of this migration (no SMTP provider is configured yet).

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

-- ===== 008_availability.sql =====
-- MediaHub platform, Phase 3b: availability per service, the way the NLAG team works today.
-- Additive. Apply after 007_scheduling.sql. Schedulers open an event for availability; members answer
-- Available or Not available for each service before anyone is scheduled. A missing answer means "not answered".

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

-- ===== 009_nlag_import.sql =====
-- MediaHub platform, Phase 3b: copy the NLAG Service Team into the platform.
-- Apply after 008_availability.sql. This only CREATES the import function; nothing is copied until the database owner runs:
--   select * from platform_private.import_nlag('<owner profile id>','New Life Assembly of God');
-- in the Supabase SQL editor (after a backup). NLAG tables are only read, never changed, so the NLAG app keeps working.
-- Re-running is safe: it adds members, skills, schedules and availability that are new since the last run and leaves
-- everything already copied alone. The result compares NLAG and platform counts.

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
