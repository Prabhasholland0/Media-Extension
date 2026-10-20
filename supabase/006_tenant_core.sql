-- Phase 2: shared platform foundation. Apply after 005_phase1_stabilize.sql.
-- Adds church profile settings, campuses, configurable roles with permissions,
-- department leaders, email invitations, an append-only activity log, organization
-- suspension and a metadata-only platform admin view.
-- Every write check now asks for a named permission instead of "is admin".
begin;

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
commit;
