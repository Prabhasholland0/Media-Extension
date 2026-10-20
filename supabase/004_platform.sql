-- MediaHub platform: many organizations, each with its own teams, positions,
-- members, events, services, service plans and schedules.
-- Apply after 001_schema.sql (it reuses public.profiles and the sign-up trigger).
-- Existing single-team tables are left untouched so the current app keeps working.
begin;

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
commit;
