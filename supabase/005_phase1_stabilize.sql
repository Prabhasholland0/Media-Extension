-- Phase 1 stabilization. Apply after 004_platform.sql.
-- 1. Keeps accounts created in the MediaHub platform out of the NLAG Service Team app.
--    Both apps share auth.users and public.profiles, so without this every platform
--    sign-up became an "active member" of NLAG and NLAG admins could read their contact details.
-- 2. Lets an organization creator's account be deleted (organizations.created_by blocked it).
-- 3. Shows invite codes only to organization admins.
-- 4. Throttles invite-code guessing.
begin;

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
commit;
